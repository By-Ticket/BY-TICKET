"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { custodialKeypair } from "@/lib/custodial/keys";
import { refreshKyc } from "@/lib/payments/kyc-flow";
import type { KycField } from "@/lib/payments/kyc-status";
import { toUnits } from "@/lib/payments/pricing";
import { completeSep10ForWallet, ensureSep10 } from "@/lib/payments/ramp-flow";
import { limitAction } from "@/lib/security/action-guard";
import { chainConfig } from "@/lib/stellar/app-chain";
import {
  buildClaimRefundXdr,
  buildTransferTicketXdr,
  readOnChainEvent,
  readOnChainTicket,
  sendClaimRefund,
  signXdr,
  submitSignedInvoke,
} from "@/lib/stellar/chain";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { assertOwnTicket } from "@/lib/tickets/access";
import { quoteResale, refundAllowed, resaleAllowed } from "@/lib/tickets/resale";
import { loadOwnWallet } from "@/lib/wallets/own";

export type TicketActionResult =
  | { ok: true; step: "sign"; xdr: string; address: string; action: string }
  | { ok: true; step: "sep10"; challengeXdr: string; address: string; homeDomain: string }
  | { ok: true; step: "kyc"; status: string; message: string; fields: KycField[] }
  | { ok: true; step: "kyc_pending"; message: string }
  | { ok: true; step: "done"; message: string; breakdown?: { fee: string; royalty: string; seller: string } }
  | { ok: false; error: string };

const listSchema = z.object({
  ticketId: z.uuid(),
  walletId: z.uuid(),
  priceUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  fiatPayout: z.enum(["true", "false"]).optional(),
});

async function loadOwnedTicket(userId: string, ticketId: string) {
  const admin = createSupabaseAdminClient();
  const { data: ticket } = await admin
    .from("tickets")
    .select("id, chain_ticket_id, owner_user_id, owner_public_key, status, transfers, event_id, tier_id")
    .eq("id", ticketId)
    .maybeSingle();
  assertOwnTicket(ticket, userId);
  return ticket;
}

export async function beginClaimRefund(input: { ticketId: string; walletId: string }): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  const limited = await limitAction("claim-refund", { limit: 10, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const ticket = await loadOwnedTicket(viewer.id, input.ticketId);
    const cfg = chainConfig();
    const onChainTicket = await readOnChainTicket(cfg, BigInt(ticket.chain_ticket_id));
    const event = await readOnChainEvent(cfg, BigInt(onChainTicket.event_id));
    const allowed = refundAllowed({
      eventStatus: event.status,
      refunded: Boolean(onChainTicket.refunded),
      owner: String(onChainTicket.owner),
      wallet: wallet.public_key,
    });
    if (!allowed.ok) return { ok: false, error: allowed.error };

    if (wallet.kind === "custodial") {
      const keypair = await custodialKeypair(wallet.id, wallet.public_key);
      const refunded = await sendClaimRefund(cfg, keypair, BigInt(ticket.chain_ticket_id));
      await markRefunded(ticket.id);
      return { ok: true, step: "done", message: `Refunded ${(Number(refunded.amount) / 10_000_000).toFixed(2)} USDC.` };
    }
    return {
      ok: true,
      step: "sign",
      xdr: await buildClaimRefundXdr(cfg, wallet.public_key, BigInt(ticket.chain_ticket_id)),
      address: wallet.public_key,
      action: `refund:${ticket.id}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not claim the refund." };
  }
}

export async function finishClaimRefund(input: { ticketId: string; walletId: string; signedXdr: string }): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const ticket = await loadOwnedTicket(viewer.id, input.ticketId);
    const submitted = await submitSignedInvoke(chainConfig(), input.signedXdr, wallet.public_key, "claim_refund");
    await markRefunded(ticket.id);
    const amount = submitted.native ? BigInt(submitted.native as bigint | number) : 0n;
    return { ok: true, step: "done", message: `Refunded ${(Number(amount) / 10_000_000).toFixed(2)} USDC.` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The refund failed." };
  }
}

async function markRefunded(ticketId: string) {
  const admin = createSupabaseAdminClient();
  await admin.from("tickets").update({ status: "void" }).eq("id", ticketId);
  await admin.from("ticket_listings").update({ status: "cancelled" }).eq("ticket_id", ticketId).in("status", ["listed", "reserved"]);
  revalidatePath("/tickets");
}

export async function beginListTicket(input: z.infer<typeof listSchema>): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid resale price." };
  const limited = await limitAction("list-ticket", { limit: 10, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  try {
    const wallet = await loadOwnWallet(viewer.id, parsed.data.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const ticket = await loadOwnedTicket(viewer.id, parsed.data.ticketId);
    if (ticket.status !== "valid") return { ok: false, error: "Only unused tickets can be listed." };
    const cfg = chainConfig();
    const onChainTicket = await readOnChainTicket(cfg, BigInt(ticket.chain_ticket_id));
    if (onChainTicket.owner !== wallet.public_key) {
      return { ok: false, error: "Sign with the wallet that holds this ticket." };
    }
    const event = await readOnChainEvent(cfg, BigInt(onChainTicket.event_id));
    const price = toUnits(parsed.data.priceUsdc);
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

    const fiat = parsed.data.fiatPayout === "true";
    if (fiat) {
      const auth = await ensureSep10(wallet);
      if ("step" in auth) {
        return { ok: true, step: "sep10", challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
      }
      const gate = await refreshKyc({
        userId: viewer.id,
        account: wallet.public_key,
        jwt: auth.jwt,
        kind: "withdraw",
        amountUsdc: Number(parsed.data.priceUsdc),
      });
      if (gate.action === "block") return { ok: false, error: gate.message };
      if (gate.action === "pending") return { ok: true, step: "kyc_pending", message: gate.message };
      if (gate.action === "form") return { ok: true, step: "kyc", status: gate.status, message: gate.message, fields: gate.fields };
    }

    const admin = createSupabaseAdminClient();
    await admin.from("ticket_listings").update({ status: "cancelled" }).eq("ticket_id", ticket.id).in("status", ["listed", "reserved"]);
    const { error } = await admin.from("ticket_listings").insert({
      ticket_id: ticket.id,
      seller_user_id: viewer.id,
      seller_wallet_id: wallet.id,
      seller_public_key: wallet.public_key,
      price_units: Number(price),
      fiat_payout: fiat,
      status: "listed",
    });
    if (error) throw error;
    const breakdown = quoteResale(price, event.feeBps, event.royaltyBps);
    revalidatePath("/tickets");
    revalidatePath(`/events/${ticket.event_id}`);
    return {
      ok: true,
      step: "done",
      message: "Listed for resale.",
      breakdown: {
        fee: (Number(breakdown.fee) / 10_000_000).toFixed(2),
        royalty: (Number(breakdown.royalty) / 10_000_000).toFixed(2),
        seller: (Number(breakdown.seller) / 10_000_000).toFixed(2),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not list this ticket." };
  }
}

export async function finishSep10List(input: z.infer<typeof listSchema> & { signedXdr: string }): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    await completeSep10ForWallet(wallet, input.signedXdr);
    return beginListTicket(input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not sign in at the anchor." };
  }
}

export async function cancelListing(listingId: string): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("ticket_listings").select("id, seller_user_id, ticket_id").eq("id", listingId).maybeSingle();
  if (!data || data.seller_user_id !== viewer.id) return { ok: false, error: "That listing is not yours." };
  await admin.from("ticket_listings").update({ status: "cancelled" }).eq("id", listingId);
  revalidatePath("/tickets");
  return { ok: true, step: "done", message: "Listing cancelled." };
}

export async function beginApproveSale(input: { listingId: string; walletId: string }): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  try {
    const admin = createSupabaseAdminClient();
    const { data: listing } = await admin
      .from("ticket_listings")
      .select("id, seller_user_id, seller_public_key, seller_wallet_id, ticket_id, price_units, status, buyer_public_key")
      .eq("id", input.listingId)
      .maybeSingle();
    if (!listing || listing.seller_user_id !== viewer.id) return { ok: false, error: "That listing is not yours." };
    if (listing.status !== "reserved" || !listing.buyer_public_key) {
      return { ok: false, error: "No buyer is waiting on this sale yet." };
    }
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet || wallet.public_key !== listing.seller_public_key) {
      return { ok: false, error: "Sign with the wallet that listed this ticket." };
    }
    const { data: ticket } = await admin.from("tickets").select("chain_ticket_id").eq("id", listing.ticket_id).maybeSingle();
    if (!ticket) return { ok: false, error: "That ticket was not found." };
    const cfg = chainConfig();
    const args = {
      ticketId: BigInt(ticket.chain_ticket_id),
      from: listing.seller_public_key,
      to: listing.buyer_public_key,
      price: BigInt(listing.price_units),
    };
    if (wallet.kind === "custodial") {
      const keypair = await custodialKeypair(wallet.id, wallet.public_key);
      const unsigned = await buildTransferTicketXdr(cfg, wallet.public_key, args);
      const signed = signXdr(cfg, unsigned, keypair);
      await admin.from("ticket_listings").update({ unsigned_xdr: unsigned, seller_signed_xdr: signed }).eq("id", listing.id);
      return { ok: true, step: "done", message: "Sale approved. The buyer can finish signing." };
    }
    const xdr = await buildTransferTicketXdr(cfg, wallet.public_key, args);
    await admin.from("ticket_listings").update({ unsigned_xdr: xdr }).eq("id", listing.id);
    return { ok: true, step: "sign", xdr, address: wallet.public_key, action: `approve:${listing.id}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not approve the sale." };
  }
}

export async function finishApproveSale(input: { listingId: string; walletId: string; signedXdr: string }): Promise<TicketActionResult> {
  const viewer = await requireViewer("/tickets");
  const admin = createSupabaseAdminClient();
  const { data: listing } = await admin.from("ticket_listings").select("id, seller_user_id").eq("id", input.listingId).maybeSingle();
  if (!listing || listing.seller_user_id !== viewer.id) return { ok: false, error: "That listing is not yours." };
  await admin.from("ticket_listings").update({ seller_signed_xdr: input.signedXdr }).eq("id", listing.id);
  return { ok: true, step: "done", message: "Sale approved. The buyer can finish signing." };
}
