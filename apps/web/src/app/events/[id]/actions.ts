"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { custodialKeypair } from "@/lib/custodial/keys";
import { usdcUnitsToZmw } from "@/lib/payments/pricing";
import { unitsToAmountString } from "@/lib/payments/format";
import { createRampAdapter, rampProvider } from "@/lib/payments/ramp";
import { refreshKyc } from "@/lib/payments/kyc-flow";
import type { KycField } from "@/lib/payments/kyc-status";
import { completeSep10ForWallet, ensureAnchorOffers, ensureSep10, insertRampTx, loadRampTx, persistStatus, updateRampTx } from "@/lib/payments/ramp-flow";
import { isTerminalRampStatus, rampStatusMessage } from "@/lib/payments/status";
import { limitAction } from "@/lib/security/action-guard";
import { chainConfig, platformKeypair } from "@/lib/stellar/app-chain";
import { stellarConfig } from "@/lib/stellar/config";
import {
  accountRecord,
  activateAccount,
  buildMintTicketXdr,
  buildTrustlineXdr,
  hasUsdcTrustline,
  readOnChainEvent,
  readOnChainTicket,
  sendMintTicket,
  submitSignedMint,
  submitTrustline,
  usdcBalance,
} from "@/lib/stellar/chain";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env.server";

export type CheckoutResult =
  | { ok: true; step: "trustline"; orderId: string; xdr: string; address: string }
  | { ok: true; step: "sign"; orderId: string; xdr: string; address: string }
  | { ok: true; step: "sep10"; orderId: string; challengeXdr: string; address: string; homeDomain: string }
  | { ok: true; step: "kyc"; orderId: string; status: string; message: string; fields: KycField[] }
  | { ok: true; step: "kyc_pending"; orderId: string; message: string }
  | { ok: true; step: "ramp"; orderId: string; rampId: string; url: string; status: string; message: string }
  | { ok: true; step: "done"; orderId: string; chainTicketId: string }
  | { ok: false; error: string };

const beginSchema = z.object({
  eventId: z.uuid(),
  tierId: z.uuid(),
  walletId: z.uuid(),
  method: z.enum(["wallet", "mobile_money", "local_currency"]),
  idempotencyKey: z.uuid(),
});

const signedSchema = z.object({
  orderId: z.uuid(),
  signedXdr: z.string().trim().min(20).max(20_000),
  step: z.enum(["trustline", "sign"]),
});

const UNAVAILABLE = "Ticket sales aren't available right now. Please try again later.";

function checkoutError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  console.error("checkout failed", message.slice(0, 400));
  if (message.includes("test USDC")) return message;
  if (message.includes("trustline")) return "This wallet still needs a USDC trustline. Try again.";
  if (message.includes("cancelled") || message.includes("rejected")) return message;
  if (/balance|underfunded|#10/i.test(message)) return "This wallet doesn't have enough test USDC or XLM.";
  return "The purchase didn't go through. Please try again.";
}

async function requireUsdc(publicKey: string, price: bigint) {
  const balance = await usdcBalance(chainConfig(), publicKey);
  if (balance >= price) return;
  throw new Error("This wallet doesn't have enough test USDC for this ticket.");
}

async function recordPurchase(input: {
  orderId: string;
  hash: string;
  ticketId: bigint;
  eventDbId: string;
  tierId: string;
  chainEventId: bigint;
}) {
  const admin = createSupabaseAdminClient();
  const ticket = await readOnChainTicket(chainConfig(), input.ticketId);
  const { data: order } = await admin
    .from("orders")
    .select("owner_public_key, user_id")
    .eq("id", input.orderId)
    .single();
  if (!order || ticket.owner !== order.owner_public_key || BigInt(ticket.event_id) !== input.chainEventId) {
    throw new Error("The ticket on the network doesn't match this order.");
  }

  const { error: orderError } = await admin
    .from("orders")
    .update({ status: "confirmed", tx_hash: input.hash, error: null })
    .eq("id", input.orderId)
    .in("status", ["pending", "submitted"]);
  if (orderError) throw orderError;

  const { error: ticketError } = await admin.from("tickets").insert({
    chain_ticket_id: Number(input.ticketId),
    event_id: input.eventDbId,
    tier_id: input.tierId,
    order_id: input.orderId,
    owner_public_key: ticket.owner,
    owner_user_id: order.user_id,
    status: "valid",
    mint_tx_hash: input.hash,
  });
  if (ticketError && ticketError.code !== "23505") throw ticketError;

  const onChain = await readOnChainEvent(chainConfig(), input.chainEventId);
  await admin.from("events").update({ tickets_sold: onChain.sold, sales_open: onChain.salesOpen }).eq("id", input.eventDbId);
  const tier = onChain.tiers[0];
  if (tier) await admin.from("ticket_tiers").update({ sold: tier.sold }).eq("id", input.tierId);

  await admin.from("audit_log").insert({
    actor_id: order.user_id,
    action: "ticket.mint",
    entity: "ticket",
    entity_id: String(input.ticketId),
    data: { tx_hash: input.hash, order_id: input.orderId },
  });
  revalidatePath("/events");
  revalidatePath(`/events/${input.eventDbId}`);
  revalidatePath("/tickets");
}

export async function beginCheckout(input: z.infer<typeof beginSchema>): Promise<CheckoutResult> {
  const viewer = await requireViewer("/events");
  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That purchase request is invalid." };
  const limited = await limitAction("checkout", { limit: 8, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured || !serverEnv.STELLAR_PLATFORM_SECRET) return { ok: false, error: UNAVAILABLE };

  try {
    const admin = createSupabaseAdminClient();
    const [{ data: event }, { data: tier }, { data: wallet }, { data: profile }] = await Promise.all([
      admin
        .from("events")
        .select("id, chain_event_id, sales_open, capacity, tickets_sold")
        .eq("id", parsed.data.eventId)
        .eq("status", "published")
        .maybeSingle(),
      admin.from("ticket_tiers").select("id, event_id, chain_tier, price_units, capacity, sold").eq("id", parsed.data.tierId).maybeSingle(),
      admin.from("wallets").select("id, user_id, kind, public_key, activated_at").eq("id", parsed.data.walletId).maybeSingle(),
      admin.from("profiles").select("phone").eq("id", viewer.id).maybeSingle(),
    ]);
    if (!event?.chain_event_id || !tier || tier.event_id !== event.id || tier.chain_tier === null) {
      return { ok: false, error: "That ticket is no longer on sale." };
    }
    if (!wallet || wallet.user_id !== viewer.id) return { ok: false, error: "Choose one of your wallets." };
    if (!event.sales_open || event.tickets_sold >= event.capacity || tier.sold >= tier.capacity) {
      return { ok: false, error: "This tier is sold out." };
    }

    const price = BigInt(tier.price_units);
    const chainEventId = BigInt(event.chain_event_id);

    const { data: existing } = await admin
      .from("orders")
      .select("id, status")
      .eq("user_id", viewer.id)
      .eq("idempotency_key", parsed.data.idempotencyKey)
      .maybeSingle();
    if (existing?.status === "confirmed") {
      const { data: ticket } = await admin.from("tickets").select("chain_ticket_id").eq("order_id", existing.id).maybeSingle();
      return { ok: true, step: "done", orderId: existing.id, chainTicketId: String(ticket?.chain_ticket_id ?? "") };
    }

    const payerIsPlatform = parsed.data.method === "mobile_money";
    if (payerIsPlatform && !profile?.phone) {
      return { ok: false, error: "Add a phone number on your account before using mobile money." };
    }
    const payer = payerIsPlatform ? platformKeypair().publicKey() : wallet.public_key;
    const paymentMethod = payerIsPlatform ? "mobile_money" : "stellar_usdc";

    let orderId = existing?.id;
    if (!orderId) {
      const { data: created, error } = await admin
        .from("orders")
        .insert({
          user_id: viewer.id,
          event_id: event.id,
          tier_id: tier.id,
          quantity: 1,
          unit_price_units: Number(price),
          total_units: Number(price),
          display_total_zmw: Math.round(usdcUnitsToZmw(price) * 100) / 100,
          payment_method: paymentMethod,
          status: "pending",
          idempotency_key: parsed.data.idempotencyKey,
          payer_public_key: payer,
          owner_public_key: wallet.public_key,
        })
        .select("id")
        .single();
      if (error) throw error;
      orderId = created.id;
    }

    const cfg = chainConfig();
    if (parsed.data.method === "local_currency") {
      return startLocalCurrency({
        viewerId: viewer.id,
        wallet,
        orderId,
        price,
        phone: profile?.phone ?? "",
      });
    }
    if (!payerIsPlatform && wallet.kind === "freighter") {
      const account = await accountRecord(cfg, wallet.public_key);
      if (!account) return { ok: false, error: "That Stellar account is not on testnet yet." };
      await requireUsdc(wallet.public_key, price);
      if (!hasUsdcTrustline(account, cfg)) {
        return { ok: true, step: "trustline", orderId, xdr: await buildTrustlineXdr(cfg, wallet.public_key), address: wallet.public_key };
      }
      return {
        ok: true,
        step: "sign",
        orderId,
        address: wallet.public_key,
        xdr: await buildMintTicketXdr(cfg, wallet.public_key, {
          payer: wallet.public_key,
          owner: wallet.public_key,
          eventId: chainEventId,
          tier: tier.chain_tier,
        }),
      };
    }

    if (!payerIsPlatform && wallet.kind === "custodial") {
      const keypair = await custodialKeypair(wallet.id, wallet.public_key);
      await activateAccount(cfg, platformKeypair(), keypair);
      await admin.from("wallets").update({ activated_at: new Date().toISOString() }).eq("id", wallet.id).is("activated_at", null);
      await requireUsdc(wallet.public_key, price);
      const minted = await sendMintTicket(cfg, keypair, {
        payer: wallet.public_key,
        owner: wallet.public_key,
        eventId: chainEventId,
        tier: tier.chain_tier,
      });
      await recordPurchase({ orderId, hash: minted.hash, ticketId: minted.ticketId, eventDbId: event.id, tierId: tier.id, chainEventId });
      return { ok: true, step: "done", orderId, chainTicketId: minted.ticketId.toString() };
    }

    const ramp = await createRampAdapter("stub");
    const session = await ramp.startOnRamp({
      reference: parsed.data.idempotencyKey,
      amountNgwee: BigInt(Math.round(usdcUnitsToZmw(price) * 100)),
      phone: profile?.phone ?? "",
      destination: platformKeypair().publicKey(),
    });
    if (session.status !== "settled") return { ok: false, error: "The mobile-money payment did not settle." };
    await requireUsdc(platformKeypair().publicKey(), price);
    const minted = await sendMintTicket(cfg, platformKeypair(), {
      payer: platformKeypair().publicKey(),
      owner: wallet.public_key,
      eventId: chainEventId,
      tier: tier.chain_tier,
    });
    await admin.from("orders").update({ ramp_reference: session.providerReference }).eq("id", orderId);
    await recordPurchase({ orderId, hash: minted.hash, ticketId: minted.ticketId, eventDbId: event.id, tierId: tier.id, chainEventId });
    return { ok: true, step: "done", orderId, chainTicketId: minted.ticketId.toString() };
  } catch (error) {
    return { ok: false, error: checkoutError(error) };
  }
}

export async function completeCheckout(input: z.infer<typeof signedSchema>): Promise<CheckoutResult> {
  const viewer = await requireViewer("/events");
  const parsed = signedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That signed transaction is invalid." };
  const limited = await limitAction("checkout-sign", { limit: 8, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  try {
    const admin = createSupabaseAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("id, user_id, status, event_id, tier_id, payer_public_key, owner_public_key")
      .eq("id", parsed.data.orderId)
      .maybeSingle();
    if (!order || order.user_id !== viewer.id || !order.payer_public_key || !order.owner_public_key) {
      return { ok: false, error: "That order was not found." };
    }
    if (order.status === "confirmed") {
      const { data: ticket } = await admin.from("tickets").select("chain_ticket_id").eq("order_id", order.id).maybeSingle();
      return { ok: true, step: "done", orderId: order.id, chainTicketId: String(ticket?.chain_ticket_id ?? "") };
    }

    const { data: event } = await admin.from("events").select("chain_event_id").eq("id", order.event_id).single();
    const { data: tier } = await admin.from("ticket_tiers").select("chain_tier, price_units").eq("id", order.tier_id).single();
    if (!event?.chain_event_id || tier?.chain_tier === null || tier?.chain_tier === undefined) {
      return { ok: false, error: "That ticket is no longer on sale." };
    }
    const cfg = chainConfig();
    const chainEventId = BigInt(event.chain_event_id);

    if (parsed.data.step === "trustline") {
      if (order.payer_public_key !== order.owner_public_key) {
        return { ok: false, error: "This order is not paid from that wallet." };
      }
      await submitTrustline(cfg, parsed.data.signedXdr, order.owner_public_key);
      await requireUsdc(order.owner_public_key, BigInt(tier.price_units));
      return {
        ok: true,
        step: "sign",
        orderId: order.id,
        address: order.owner_public_key,
        xdr: await buildMintTicketXdr(cfg, order.owner_public_key, {
          payer: order.owner_public_key,
          owner: order.owner_public_key,
          eventId: chainEventId,
          tier: tier.chain_tier,
        }),
      };
    }

    const minted = await submitSignedMint(cfg, parsed.data.signedXdr, { payer: order.payer_public_key, eventId: chainEventId });
    await recordPurchase({
      orderId: order.id,
      hash: minted.hash,
      ticketId: minted.ticketId,
      eventDbId: order.event_id,
      tierId: order.tier_id,
      chainEventId,
    });
    return { ok: true, step: "done", orderId: order.id, chainTicketId: minted.ticketId.toString() };
  } catch (error) {
    return { ok: false, error: checkoutError(error) };
  }
}

type CheckoutWallet = { id: string; kind: "custodial" | "freighter"; public_key: string };

async function startLocalCurrency(input: {
  viewerId: string;
  wallet: CheckoutWallet;
  orderId: string;
  price: bigint;
  phone: string;
}): Promise<CheckoutResult> {
  if (rampProvider() === "sep24") {
    const missing = await ensureAnchorOffers("deposit");
    if (missing) return { ok: false, error: missing };
  }

  const auth = await ensureSep10(input.wallet);
  if ("step" in auth) {
    return {
      ok: true,
      step: "sep10",
      orderId: input.orderId,
      challengeXdr: auth.challengeXdr,
      address: auth.address,
      homeDomain: auth.homeDomain,
    };
  }

  const amountUsdc = Number(unitsToAmountString(input.price));
  const gate = await refreshKyc({
    userId: input.viewerId,
    account: input.wallet.public_key,
    jwt: auth.jwt,
    kind: "deposit",
    amountUsdc,
  });
  if (gate.action === "block") return { ok: false, error: gate.message };
  if (gate.action === "pending") {
    return { ok: true, step: "kyc_pending", orderId: input.orderId, message: gate.message };
  }
  if (gate.action === "form") {
    return { ok: true, step: "kyc", orderId: input.orderId, status: gate.status, message: gate.message, fields: gate.fields };
  }

  const adapter = await createRampAdapter(rampProvider(), auth.jwt);
  const session = await adapter.startOnRamp({
    reference: input.orderId,
    amountNgwee: BigInt(Math.round(usdcUnitsToZmw(input.price) * 100)),
    amountUsdc: unitsToAmountString(input.price),
    assetCode: stellarConfig.usdc.code,
    assetIssuer: stellarConfig.usdc.issuer,
    phone: input.phone,
    destination: input.wallet.public_key,
  });
  if (adapter.provider === "stub" && session.status === "settled") {
    await insertRampTx({
      user_id: input.viewerId,
      kind: "deposit",
      amount: Number(unitsToAmountString(input.price)),
      asset_code: stellarConfig.usdc.code,
      asset_issuer: stellarConfig.usdc.issuer,
      anchor_tx_id: session.providerReference,
      status: "settled",
      provider: "stub",
      order_id: input.orderId,
    });
    const admin = createSupabaseAdminClient();
    const { data: order } = await admin.from("orders").select("event_id, tier_id").eq("id", input.orderId).single();
    const { data: event } = await admin.from("events").select("chain_event_id").eq("id", order!.event_id).single();
    const { data: tier } = await admin.from("ticket_tiers").select("chain_tier").eq("id", order!.tier_id).single();
    const cfg = chainConfig();
    const chainEventId = BigInt(event!.chain_event_id!);
    await requireUsdc(platformKeypair().publicKey(), input.price);
    const minted = await sendMintTicket(cfg, platformKeypair(), {
      payer: platformKeypair().publicKey(),
      owner: input.wallet.public_key,
      eventId: chainEventId,
      tier: tier!.chain_tier!,
    });
    await recordPurchase({
      orderId: input.orderId,
      hash: minted.hash,
      ticketId: minted.ticketId,
      eventDbId: order!.event_id,
      tierId: order!.tier_id,
      chainEventId,
    });
    return { ok: true, step: "done", orderId: input.orderId, chainTicketId: minted.ticketId.toString() };
  }
  const row = await insertRampTx({
    user_id: input.viewerId,
    kind: "deposit",
    amount: Number(unitsToAmountString(input.price)),
    asset_code: stellarConfig.usdc.code,
    asset_issuer: stellarConfig.usdc.issuer,
    anchor_tx_id: session.providerReference,
    status: persistStatus(session.status),
    provider: adapter.provider,
    interactive_url: session.interactiveUrl,
    order_id: input.orderId,
  });
  return {
    ok: true,
    step: "ramp",
    orderId: input.orderId,
    rampId: row.id,
    url: session.interactiveUrl ?? "",
    status: session.status,
    message: rampStatusMessage(session.status),
  };
}

export async function finishSep10Checkout(input: {
  orderId: string;
  walletId: string;
  signedXdr: string;
}): Promise<CheckoutResult> {
  const viewer = await requireViewer("/events");
  const limited = await limitAction("sep10", { limit: 8, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: wallet }, { data: order }] = await Promise.all([
      admin.from("wallets").select("id, user_id, kind, public_key").eq("id", input.walletId).maybeSingle(),
      admin.from("orders").select("id, user_id, event_id, tier_id, unit_price_units").eq("id", input.orderId).maybeSingle(),
    ]);
    if (!wallet || wallet.user_id !== viewer.id || !order || order.user_id !== viewer.id) {
      return { ok: false, error: "That order was not found." };
    }
    await completeSep10ForWallet(wallet, input.signedXdr);
    const { data: profile } = await admin.from("profiles").select("phone").eq("id", viewer.id).maybeSingle();
    return startLocalCurrency({
      viewerId: viewer.id,
      wallet,
      orderId: order.id,
      price: BigInt(order.unit_price_units),
      phone: profile?.phone ?? "",
    });
  } catch (error) {
    return { ok: false, error: checkoutError(error) };
  }
}

export async function pollLocalCurrencyCheckout(input: { rampId: string; walletId: string }): Promise<CheckoutResult> {
  const viewer = await requireViewer("/events");
  try {
    const row = await loadRampTx(input.rampId, viewer.id);
    if (!row || !row.order_id || !row.anchor_tx_id) return { ok: false, error: "That transfer was not found." };
    const admin = createSupabaseAdminClient();
    const { data: wallet } = await admin.from("wallets").select("id, user_id, kind, public_key").eq("id", input.walletId).maybeSingle();
    if (!wallet || wallet.user_id !== viewer.id) return { ok: false, error: "Choose one of your wallets." };
    const auth = await ensureSep10(wallet);
    if ("step" in auth) {
      return { ok: true, step: "sep10", orderId: row.order_id, challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
    }
    const adapter = await createRampAdapter(rampProvider(), auth.jwt);
    const session = await adapter.getStatus(row.anchor_tx_id);
    await updateRampTx(row.id, viewer.id, { status: persistStatus(session.status) });
    if (session.status === "settled") {
      const { data: order } = await admin.from("orders").select("unit_price_units").eq("id", row.order_id).single();
      if (!order) return { ok: false, error: "That order was not found." };
      return mintFromWalletAfterRamp(row.order_id, wallet, BigInt(order.unit_price_units));
    }
    if (isTerminalRampStatus(session.status)) {
      return { ok: false, error: rampStatusMessage(session.status) };
    }
    return {
      ok: true,
      step: "ramp",
      orderId: row.order_id,
      rampId: row.id,
      url: row.interactive_url ?? session.interactiveUrl ?? "",
      status: session.status,
      message: rampStatusMessage(session.status),
    };
  } catch (error) {
    return { ok: false, error: checkoutError(error) };
  }
}

async function mintFromWalletAfterRamp(orderId: string, wallet: CheckoutWallet, price: bigint): Promise<CheckoutResult> {
  const admin = createSupabaseAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, user_id, event_id, tier_id, status")
    .eq("id", orderId)
    .single();
  if (!order) return { ok: false, error: "That order was not found." };
  if (order.status === "confirmed") {
    const { data: ticket } = await admin.from("tickets").select("chain_ticket_id").eq("order_id", order.id).maybeSingle();
    return { ok: true, step: "done", orderId: order.id, chainTicketId: String(ticket?.chain_ticket_id ?? "") };
  }
  const { data: event } = await admin.from("events").select("chain_event_id").eq("id", order.event_id).single();
  const { data: tier } = await admin.from("ticket_tiers").select("chain_tier").eq("id", order.tier_id).single();
  if (!event?.chain_event_id || tier?.chain_tier === null || tier?.chain_tier === undefined) {
    return { ok: false, error: "That ticket is no longer on sale." };
  }
  const cfg = chainConfig();
  const chainEventId = BigInt(event.chain_event_id);
  await requireUsdc(wallet.public_key, price);
  if (wallet.kind === "freighter") {
    return {
      ok: true,
      step: "sign",
      orderId: order.id,
      address: wallet.public_key,
      xdr: await buildMintTicketXdr(cfg, wallet.public_key, {
        payer: wallet.public_key,
        owner: wallet.public_key,
        eventId: chainEventId,
        tier: tier.chain_tier,
      }),
    };
  }
  const keypair = await custodialKeypair(wallet.id, wallet.public_key);
  const minted = await sendMintTicket(cfg, keypair, {
    payer: wallet.public_key,
    owner: wallet.public_key,
    eventId: chainEventId,
    tier: tier.chain_tier,
  });
  await recordPurchase({
    orderId: order.id,
    hash: minted.hash,
    ticketId: minted.ticketId,
    eventDbId: order.event_id,
    tierId: order.tier_id,
    chainEventId,
  });
  return { ok: true, step: "done", orderId: order.id, chainTicketId: minted.ticketId.toString() };
}
