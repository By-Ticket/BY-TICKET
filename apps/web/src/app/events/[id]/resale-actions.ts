"use server";

import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { custodialKeypair } from "@/lib/custodial/keys";
import { formatPrice } from "@/lib/payments/pricing";
import { limitAction } from "@/lib/security/action-guard";
import { chainConfig } from "@/lib/stellar/app-chain";
import {
  accountRecord,
  buildTransferTicketXdr,
  hasUsdcTrustline,
  readOnChainEvent,
  readOnChainTicket,
  signXdr,
  submitSignedInvoke,
} from "@/lib/stellar/chain";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { quoteResale, resaleAllowed } from "@/lib/tickets/resale";
import { loadOwnWallet } from "@/lib/wallets/own";
import { recordResale } from "@/lib/tickets/record-resale";

export type BuyListingResult =
  | { ok: true; step: "sign"; xdr: string; address: string; breakdown: { fee: string; royalty: string; seller: string; price: string } }
  | { ok: true; step: "wait_seller"; message: string; breakdown: { fee: string; royalty: string; seller: string; price: string } }
  | { ok: true; step: "done"; message: string }
  | { ok: false; error: string };

const buySchema = z.object({ listingId: z.uuid(), walletId: z.uuid() });

export async function quoteListing(listingId: string) {
  const admin = createSupabaseAdminClient();
  const { data: listing } = await admin
    .from("ticket_listings")
    .select("id, price_units, ticket_id, status")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || listing.status !== "listed") return null;
  const { data: ticket } = await admin.from("tickets").select("chain_ticket_id").eq("id", listing.ticket_id).maybeSingle();
  if (!ticket) return null;
  const cfg = chainConfig();
  const onChainTicket = await readOnChainTicket(cfg, BigInt(ticket.chain_ticket_id));
  const event = await readOnChainEvent(cfg, BigInt(onChainTicket.event_id));
  const quoted = quoteResale(BigInt(listing.price_units), event.feeBps, event.royaltyBps);
  return {
    price: formatPrice(quoted.price).usdc,
    fee: formatPrice(quoted.fee).usdc,
    royalty: formatPrice(quoted.royalty).usdc,
    seller: formatPrice(quoted.seller).usdc,
    cap: formatPrice(event.resaleCap).usdc,
  };
}

export async function beginBuyListing(input: z.infer<typeof buySchema>): Promise<BuyListingResult> {
  const viewer = await requireViewer("/events");
  const parsed = buySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a listing and a wallet." };
  const limited = await limitAction("buy-listing", { limit: 8, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  try {
    const wallet = await loadOwnWallet(viewer.id, parsed.data.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const admin = createSupabaseAdminClient();
    const { data: listing } = await admin.from("ticket_listings").select("*").eq("id", parsed.data.listingId).maybeSingle();
    if (!listing || listing.status !== "listed") return { ok: false, error: "That listing is no longer available." };
    if (listing.seller_user_id === viewer.id) return { ok: false, error: "You already own this ticket." };

    const { data: ticket } = await admin
      .from("tickets")
      .select("id, chain_ticket_id, event_id, transfers")
      .eq("id", listing.ticket_id)
      .maybeSingle();
    if (!ticket) return { ok: false, error: "That ticket was not found." };
    const cfg = chainConfig();
    const onChainTicket = await readOnChainTicket(cfg, BigInt(ticket.chain_ticket_id));
    const event = await readOnChainEvent(cfg, BigInt(onChainTicket.event_id));
    const price = BigInt(listing.price_units);
    const allowed = resaleAllowed({
      eventStatus: event.status,
      checkedIn: Boolean(onChainTicket.checked_in),
      refunded: Boolean(onChainTicket.refunded),
      transfers: Number(onChainTicket.transfers ?? ticket.transfers),
      maxTransfers: event.maxTransfers,
      price,
      resaleCap: event.resaleCap,
    });
    if (!allowed.ok) return { ok: false, error: allowed.error };

    const quoted = quoteResale(price, event.feeBps, event.royaltyBps);
    const breakdown = {
      fee: formatPrice(quoted.fee).usdc,
      royalty: formatPrice(quoted.royalty).usdc,
      seller: formatPrice(quoted.seller).usdc,
      price: formatPrice(quoted.price).usdc,
    };

    const account = await accountRecord(cfg, wallet.public_key);
    if (account && !hasUsdcTrustline(account, cfg) && price > 0n) {
      return { ok: false, error: "Add a USDC trustline before buying this ticket." };
    }

    const { data: reserved } = await admin
      .from("ticket_listings")
      .update({ status: "reserved", buyer_user_id: viewer.id, buyer_public_key: wallet.public_key })
      .eq("id", listing.id)
      .eq("status", "listed")
      .select("id")
      .maybeSingle();
    if (!reserved) return { ok: false, error: "That listing is no longer available." };

    try {
      const args = {
        ticketId: BigInt(ticket.chain_ticket_id),
        from: listing.seller_public_key,
        to: wallet.public_key,
        price,
      };

      const { data: sellerWallet } = await admin.from("wallets").select("id, kind, public_key").eq("id", listing.seller_wallet_id).maybeSingle();
      const unsigned = await buildTransferTicketXdr(cfg, listing.seller_public_key, args);
      if (sellerWallet?.kind === "custodial") {
        const sellerKey = await custodialKeypair(sellerWallet.id, sellerWallet.public_key);
        let signed = signXdr(cfg, unsigned, sellerKey);
        if (wallet.kind === "custodial") {
          const buyerKey = await custodialKeypair(wallet.id, wallet.public_key);
          signed = signXdr(cfg, signed, buyerKey);
          const submitted = await submitSignedInvoke(cfg, signed, listing.seller_public_key, "transfer_ticket");
          await recordResale(listing.id, submitted.hash);
          return { ok: true, step: "done", message: "Ticket is in your wallet." };
        }
        await admin.from("ticket_listings").update({ seller_signed_xdr: signed, unsigned_xdr: unsigned }).eq("id", listing.id);
        return { ok: true, step: "sign", xdr: signed, address: wallet.public_key, breakdown };
      }

      await admin.from("ticket_listings").update({ unsigned_xdr: unsigned }).eq("id", listing.id);
      return {
        ok: true,
        step: "wait_seller",
        message: "The seller needs to approve this sale from My Tickets, then you can sign.",
        breakdown,
      };
    } catch (error) {
      await admin
        .from("ticket_listings")
        .update({ status: "listed", buyer_user_id: null, buyer_public_key: null, unsigned_xdr: null, seller_signed_xdr: null })
        .eq("id", listing.id)
        .eq("status", "reserved")
        .eq("buyer_user_id", viewer.id);
      throw error;
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not start the purchase." };
  }
}

export async function finishBuyListing(input: { listingId: string; walletId: string; signedXdr: string }): Promise<BuyListingResult> {
  const viewer = await requireViewer("/events");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const admin = createSupabaseAdminClient();
    const { data: listing } = await admin.from("ticket_listings").select("seller_public_key, buyer_user_id").eq("id", input.listingId).maybeSingle();
    if (!listing || listing.buyer_user_id !== viewer.id) return { ok: false, error: "That purchase was not found." };
    const submitted = await submitSignedInvoke(chainConfig(), input.signedXdr, listing.seller_public_key, "transfer_ticket");
    await recordResale(input.listingId, submitted.hash);
    return { ok: true, step: "done", message: "Ticket is in your wallet." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The purchase failed." };
  }
}

export async function pollBuyListing(listingId: string): Promise<BuyListingResult> {
  const viewer = await requireViewer("/events");
  const admin = createSupabaseAdminClient();
  const { data: listing } = await admin
    .from("ticket_listings")
    .select("status, seller_signed_xdr, buyer_user_id, buyer_public_key")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || listing.buyer_user_id !== viewer.id) return { ok: false, error: "That purchase was not found." };
  if (listing.status === "sold") return { ok: true, step: "done", message: "Ticket is in your wallet." };
  if (listing.seller_signed_xdr && listing.buyer_public_key) {
    return {
      ok: true,
      step: "sign",
      xdr: listing.seller_signed_xdr,
      address: listing.buyer_public_key,
      breakdown: { fee: "", royalty: "", seller: "", price: "" },
    };
  }
  return { ok: true, step: "wait_seller", message: "Waiting for the seller to approve.", breakdown: { fee: "", royalty: "", seller: "", price: "" } };
}

