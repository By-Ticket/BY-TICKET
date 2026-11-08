"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { eventMetadataHash } from "@/lib/events/metadata";
import { toUnits } from "@/lib/payments/pricing";
import { limitAction } from "@/lib/security/action-guard";
import { chainConfig } from "@/lib/stellar/app-chain";
import {
  buildCancelEventXdr,
  buildCompleteEventXdr,
  buildCreateEventXdr,
  buildReleasePayoutXdr,
  buildSetMilestoneXdr,
  readEscrowBalance,
  readEventStatus,
  readIsOrganizer,
  readOnChainEvent,
  sendCancelEvent,
  sendCompleteEvent,
  sendCreateEvent,
  sendReleasePayout,
  sendSetMilestone,
  submitSignedInvoke,
} from "@/lib/stellar/chain";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { royaltyPercentToBps, unixSeconds } from "@/lib/tickets/resale";
import { assertOrganizerEvent } from "@/lib/tickets/access";
import { slugify, stellarAccountSchema } from "@/lib/validation/account";
import { custodialKeypair } from "@/lib/custodial/keys";
import { loadOwnWallet } from "@/lib/wallets/own";

export type ChainSignResult =
  | { ok: true; step: "sign"; xdr: string; address: string; action: string }
  | { ok: true; step: "done"; message: string; amountUsdc?: string; payoutId?: string }
  | { ok: false; error: string };

const createSchema = z.object({
  walletId: z.uuid(),
  title: z.string().trim().min(3).max(120),
  venue_name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  starts_at: z.string().min(10),
  ends_at: z.string().optional(),
  capacity: z.coerce.number().int().min(1).max(1_000_000),
  priceUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  max_transfers: z.coerce.number().int().min(0).max(100),
  resaleCapUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
  royaltyPercent: z.string().regex(/^\d+(\.\d{1,2})?$/),
  payout_public_key: z.preprocess((v) => (v === "" ? undefined : v), stellarAccountSchema.optional()),
});

function isoFromLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date and time.");
  return date.toISOString();
}

async function ownOrganizer(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("organizers").select("id, user_id, payout_public_key, status").eq("user_id", userId).maybeSingle();
  if (!data || data.status !== "approved") return null;
  return data;
}

function chainError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The contract call failed.";
  if (message.includes("NotOrganizer") || message.includes("#1")) {
    return "This wallet is not on the contract organizer list yet. An admin must run approve_organizer.";
  }
  if (message.includes("TooEarly") || message.includes("#22")) {
    return "The event has not ended yet.";
  }
  if (message.includes("EventNotCompleted") || message.includes("#23")) {
    return "Complete the event (or hit the check-in milestone) before releasing payout.";
  }
  if (message.includes("AlreadyReleased") || message.includes("#24")) {
    return "That payout was already released.";
  }
  if (message.includes("EventCancelled") || message.includes("#21")) {
    return "This event is cancelled.";
  }
  return message;
}

export async function beginCreateEvent(form: FormData): Promise<ChainSignResult> {
  const viewer = await requireRole("organizer", "/organizer");
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the event details." };
  const limited = await limitAction("create-event", { limit: 8, windowMs: 60 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };

  try {
    const org = await ownOrganizer(viewer.id);
    if (!org) return { ok: false, error: "Your organizer account is not approved." };
    const wallet = await loadOwnWallet(viewer.id, parsed.data.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };

    const cfg = chainConfig();
    if (!(await readIsOrganizer(cfg, wallet.public_key))) {
      return { ok: false, error: "This wallet is not approved on the ticket contract yet." };
    }

    const startsAt = isoFromLocal(parsed.data.starts_at);
    const endsAt = parsed.data.ends_at ? isoFromLocal(parsed.data.ends_at) : null;
    if (endsAt && endsAt <= startsAt) return { ok: false, error: "The end time must be after the start." };

    const price = toUnits(parsed.data.priceUsdc);
    const resaleCap = toUnits(parsed.data.resaleCapUsdc);
    const royaltyBps = royaltyPercentToBps(parsed.data.royaltyPercent);
    const recipient = parsed.data.payout_public_key ?? org.payout_public_key ?? wallet.public_key;
    const hash = eventMetadataHash({
      title: parsed.data.title,
      venue_name: parsed.data.venue_name,
      city: parsed.data.city,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity: parsed.data.capacity,
    });
    const args = {
      organizer: wallet.public_key,
      capacity: parsed.data.capacity,
      price,
      maxTransfers: parsed.data.max_transfers,
      resaleCap,
      splits: [{ recipient, bps: 10_000 }],
      metadataHash: hash.bytes,
      endsAt: unixSeconds(endsAt),
      royaltyBps,
    };

    const persistInput = {
      organizerId: org.id,
      title: parsed.data.title,
      venue_name: parsed.data.venue_name,
      city: parsed.data.city,
      startsAt,
      endsAt,
      capacity: parsed.data.capacity,
      price: price.toString(),
      maxTransfers: parsed.data.max_transfers,
      resaleCap: resaleCap.toString(),
      royaltyBps,
      recipient,
      metadataHex: hash.hex,
    };

    if (wallet.kind === "custodial") {
      const keypair = await custodialKeypair(wallet.id, wallet.public_key);
      const created = await sendCreateEvent(cfg, keypair, args);
      await persistPublishedEvent({
        ...persistInput,
        wallet,
        price,
        resaleCap,
        chainEventId: created.eventId,
        txHash: created.hash,
      });
      return { ok: true, step: "done", message: `Event created on-chain (#${created.eventId}).` };
    }

    const xdr = await buildCreateEventXdr(cfg, wallet.public_key, args);
    const admin = createSupabaseAdminClient();
    await admin.from("idempotency_keys").upsert(
      {
        user_id: viewer.id,
        key: `create-event:${hash.hex}`,
        request_hash: hash.hex,
        route: "create_event",
        response: persistInput,
      },
      { onConflict: "user_id,key" },
    );
    return { ok: true, step: "sign", xdr, address: wallet.public_key, action: `create:${hash.hex}` };
  } catch (error) {
    return { ok: false, error: chainError(error) };
  }
}

export async function finishCreateEvent(input: { walletId: string; signedXdr: string; action: string }): Promise<ChainSignResult> {
  const viewer = await requireRole("organizer", "/organizer");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const hex = input.action.replace(/^create:/, "");
    const admin = createSupabaseAdminClient();
    const { data: pending } = await admin
      .from("idempotency_keys")
      .select("response")
      .eq("user_id", viewer.id)
      .eq("key", `create-event:${hex}`)
      .maybeSingle();
    const saved = pending?.response as {
      organizerId: string;
      title: string;
      venue_name: string;
      city: string;
      startsAt: string;
      endsAt: string | null;
      capacity: number;
      price: string;
      maxTransfers: number;
      resaleCap: string;
      royaltyBps: number;
      recipient: string;
      metadataHex: string;
    } | null;
    if (!saved) return { ok: false, error: "Start creating the event again." };

    const submitted = await submitSignedInvoke(chainConfig(), input.signedXdr, wallet.public_key, "create_event");
    const eventId = BigInt(submitted.native as bigint | number);
    await persistPublishedEvent({
      organizerId: saved.organizerId,
      wallet,
      title: saved.title,
      venue_name: saved.venue_name,
      city: saved.city,
      startsAt: saved.startsAt,
      endsAt: saved.endsAt,
      capacity: saved.capacity,
      price: BigInt(saved.price),
      maxTransfers: saved.maxTransfers,
      resaleCap: BigInt(saved.resaleCap),
      royaltyBps: saved.royaltyBps,
      recipient: saved.recipient,
      metadataHex: saved.metadataHex,
      chainEventId: eventId,
      txHash: submitted.hash,
    });
    return { ok: true, step: "done", message: `Event created on-chain (#${eventId}).` };
  } catch (error) {
    return { ok: false, error: chainError(error) };
  }
}

async function persistPublishedEvent(input: {
  organizerId: string;
  wallet: { id: string; public_key: string };
  title: string;
  venue_name: string;
  city: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
  price: bigint;
  maxTransfers: number;
  resaleCap: bigint;
  royaltyBps: number;
  recipient: string;
  metadataHex: string;
  chainEventId: bigint;
  txHash: string;
}) {
  const admin = createSupabaseAdminClient();
  const onChain = await readOnChainEvent(chainConfig(), input.chainEventId);
  let slug = slugify(input.title);
  const { data: clash } = await admin.from("events").select("id").eq("organizer_id", input.organizerId).eq("slug", slug).maybeSingle();
  if (clash) slug = `${slug}-${input.chainEventId}`;
  const { data: event, error } = await admin
    .from("events")
    .insert({
      organizer_id: input.organizerId,
      title: input.title,
      slug,
      venue_name: input.venue_name,
      city: input.city,
      country: "ZM",
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      capacity: input.capacity,
      max_transfers: input.maxTransfers,
      resale_cap_units: Number(input.resaleCap),
      royalty_bps: input.royaltyBps,
      splits: [{ recipient: input.recipient, bps: 10_000, label: "Organizer" }],
      status: "published",
      sales_open: onChain.salesOpen,
      chain_event_id: Number(input.chainEventId),
      metadata_hash: input.metadataHex,
      fee_bps: onChain.feeBps,
      create_tx_hash: input.txHash,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: tierError } = await admin.from("ticket_tiers").insert({
    event_id: event.id,
    chain_tier: 0,
    name: "General admission",
    price_units: Number(input.price),
    capacity: input.capacity,
    sort_order: 0,
  });
  if (tierError) throw tierError;
  revalidatePath("/organizer");
  revalidatePath("/events");
}

async function loadManagedEvent(userId: string, eventId: string) {
  const org = await ownOrganizer(userId);
  if (!org) throw new Error("Your organizer account is not approved.");
  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, organizer_id, chain_event_id, title, status")
    .eq("id", eventId)
    .maybeSingle();
  assertOrganizerEvent(event, org.id);
  if (!event.chain_event_id) throw new Error("This event is not on-chain yet.");
  return { event, org, chainEventId: BigInt(event.chain_event_id) };
}

export async function beginEventAction(input: {
  eventId: string;
  walletId: string;
  action: "complete" | "cancel" | "release" | "milestone";
  minCheckins?: number;
  partialPercent?: number;
}): Promise<ChainSignResult> {
  const viewer = await requireRole("organizer", "/organizer");
  const limited = await limitAction("event-manage", { limit: 20, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const { event, chainEventId } = await loadManagedEvent(viewer.id, input.eventId);
    const cfg = chainConfig();
    const onChain = await readOnChainEvent(cfg, chainEventId);

    if (input.action === "complete") {
      if (onChain.endsAt > 0n && BigInt(Math.floor(Date.now() / 1000)) < onChain.endsAt) {
        return { ok: false, error: "Wait until the event end time before completing." };
      }
      if (wallet.kind === "custodial") {
        const keypair = await custodialKeypair(wallet.id, wallet.public_key);
        await sendCompleteEvent(cfg, keypair, chainEventId);
        await createSupabaseAdminClient().from("events").update({ status: "completed", sales_open: false }).eq("id", event.id);
        revalidatePath("/organizer");
        return { ok: true, step: "done", message: "Event marked complete on-chain." };
      }
      return {
        ok: true,
        step: "sign",
        xdr: await buildCompleteEventXdr(cfg, wallet.public_key, chainEventId),
        address: wallet.public_key,
        action: `complete:${event.id}`,
      };
    }

    if (input.action === "cancel") {
      if (wallet.kind === "custodial") {
        const keypair = await custodialKeypair(wallet.id, wallet.public_key);
        await sendCancelEvent(cfg, keypair, chainEventId);
        await createSupabaseAdminClient().from("events").update({ status: "cancelled", sales_open: false }).eq("id", event.id);
        revalidatePath("/organizer");
        revalidatePath("/tickets");
        return { ok: true, step: "done", message: "Event cancelled. Holders can claim refunds." };
      }
      return {
        ok: true,
        step: "sign",
        xdr: await buildCancelEventXdr(cfg, wallet.public_key, chainEventId),
        address: wallet.public_key,
        action: `cancel:${event.id}`,
      };
    }

    if (input.action === "milestone") {
      const minCheckins = Math.max(0, Math.floor(input.minCheckins ?? 0));
      const partialBps = Math.min(10_000, Math.max(0, Math.round((input.partialPercent ?? 0) * 100)));
      if (partialBps <= 0 || minCheckins <= 0) {
        return { ok: false, error: "Set a check-in count and a payout percent." };
      }
      if (wallet.kind === "custodial") {
        const keypair = await custodialKeypair(wallet.id, wallet.public_key);
        await sendSetMilestone(cfg, keypair, chainEventId, minCheckins, partialBps);
        revalidatePath("/organizer");
        return { ok: true, step: "done", message: "Payout milestone saved on-chain." };
      }
      return {
        ok: true,
        step: "sign",
        xdr: await buildSetMilestoneXdr(cfg, wallet.public_key, chainEventId, minCheckins, partialBps),
        address: wallet.public_key,
        action: `milestone:${event.id}:${minCheckins}:${partialBps}`,
      };
    }

    if (wallet.kind === "custodial") {
      const keypair = await custodialKeypair(wallet.id, wallet.public_key);
      const released = await sendReleasePayout(cfg, keypair, chainEventId);
      const payoutId = await recordPayout(event.id, released.amount, released.hash, onChain.status !== "Completed");
      revalidatePath("/organizer");
      return {
        ok: true,
        step: "done",
        message: "Payout released to your split wallets.",
        amountUsdc: (Number(released.amount) / 10_000_000).toString(),
        payoutId,
      };
    }
    return {
      ok: true,
      step: "sign",
      xdr: await buildReleasePayoutXdr(cfg, wallet.public_key, chainEventId),
      address: wallet.public_key,
      action: `release:${event.id}`,
    };
  } catch (error) {
    return { ok: false, error: chainError(error) };
  }
}

export async function finishEventAction(input: { walletId: string; signedXdr: string; action: string }): Promise<ChainSignResult> {
  const viewer = await requireRole("organizer", "/organizer");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const [kind, eventId] = input.action.split(":");
    if (!kind || !eventId) return { ok: false, error: "Unknown action." };
    const { event, chainEventId } = await loadManagedEvent(viewer.id, eventId);
    const method =
      kind === "complete"
        ? "complete_event"
        : kind === "cancel"
          ? "cancel_event"
          : kind === "release"
            ? "release_payout"
            : "set_payout_milestone";
    const submitted = await submitSignedInvoke(chainConfig(), input.signedXdr, wallet.public_key, method);
    const admin = createSupabaseAdminClient();
    if (kind === "complete") {
      await admin.from("events").update({ status: "completed", sales_open: false }).eq("id", event.id);
      revalidatePath("/organizer");
      return { ok: true, step: "done", message: "Event marked complete on-chain." };
    }
    if (kind === "cancel") {
      await admin.from("events").update({ status: "cancelled", sales_open: false }).eq("id", event.id);
      revalidatePath("/organizer");
      revalidatePath("/tickets");
      return { ok: true, step: "done", message: "Event cancelled. Holders can claim refunds." };
    }
    if (kind === "release") {
      const amount = BigInt(submitted.native as bigint | number);
      const status = await readEventStatus(chainConfig(), chainEventId);
      const payoutId = await recordPayout(event.id, amount, submitted.hash, status !== "Completed");
      revalidatePath("/organizer");
      return {
        ok: true,
        step: "done",
        message: "Payout released to your split wallets.",
        amountUsdc: (Number(amount) / 10_000_000).toString(),
        payoutId,
      };
    }
    revalidatePath("/organizer");
    return { ok: true, step: "done", message: "Payout milestone saved on-chain." };
  } catch (error) {
    return { ok: false, error: chainError(error) };
  }
}

async function recordPayout(eventId: string, amount: bigint, txHash: string, partial: boolean): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("event_payouts")
    .upsert({ event_id: eventId, amount_units: Number(amount), tx_hash: txHash, partial }, { onConflict: "tx_hash" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function loadEventChainState(chainEventId: number) {
  const cfg = chainConfig();
  const id = BigInt(chainEventId);
  const [status, escrow, event] = await Promise.all([
    readEventStatus(cfg, id),
    readEscrowBalance(cfg, id),
    readOnChainEvent(cfg, id),
  ]);
  return {
    status: status ?? event.status ?? "Live",
    escrow,
    royaltyBps: event.royaltyBps,
    endsAt: event.endsAt,
    payoutReleased: event.payoutReleased,
    partialReleased: event.partialReleased,
    checkedIn: event.checkedIn,
    minCheckinsPartial: event.minCheckinsPartial,
    ended: event.endsAt === 0n || event.endsAt <= BigInt(Math.floor(Date.now() / 1000)),
  };
}
