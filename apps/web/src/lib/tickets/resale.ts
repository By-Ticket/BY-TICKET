export const MAX_ROYALTY_BPS = 1_500;
export const BPS_DENOMINATOR = 10_000n;

export interface ResaleBreakdown {
  price: bigint;
  fee: bigint;
  royalty: bigint;
  seller: bigint;
}

/** Same integer math as `compute_resale` in `event_ticket`. */
export function quoteResale(price: bigint, feeBps: number, royaltyBps: number): ResaleBreakdown {
  if (price < 0n) throw new Error("Price cannot be negative.");
  const fee = (price * BigInt(feeBps)) / BPS_DENOMINATOR;
  const royalty = (price * BigInt(royaltyBps)) / BPS_DENOMINATOR;
  return { price, fee, royalty, seller: price - fee - royalty };
}

/** Percent string ("10" or "10.5") → bps, capped at 15%. */
export function royaltyPercentToBps(percent: string | number): number {
  const value = typeof percent === "number" ? percent : Number(percent);
  if (!Number.isFinite(value) || value < 0) return 0;
  const bps = Math.round(value * 100);
  return Math.min(MAX_ROYALTY_BPS, bps);
}

export function unixSeconds(iso: string | Date | null | undefined): bigint {
  if (!iso) return 0n;
  const ms = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(ms)) return 0n;
  return BigInt(Math.floor(ms / 1000));
}

export type ResaleBlockReason =
  | "not_live"
  | "checked_in"
  | "refunded"
  | "transfer_limit"
  | "cap_exceeded"
  | "invalid_price";

export function resaleAllowed(input: {
  eventStatus?: string | null;
  checkedIn?: boolean;
  refunded?: boolean;
  transfers: number;
  maxTransfers: number;
  price: bigint;
  resaleCap: bigint;
}): { ok: true } | { ok: false; reason: ResaleBlockReason; error: string } {
  if (input.eventStatus && input.eventStatus !== "Live") {
    return { ok: false, reason: "not_live", error: "Resale is only open while the event is live." };
  }
  if (input.checkedIn) {
    return { ok: false, reason: "checked_in", error: "This ticket was already used." };
  }
  if (input.refunded) {
    return { ok: false, reason: "refunded", error: "This ticket was refunded." };
  }
  if (input.maxTransfers <= 0 || input.transfers >= input.maxTransfers) {
    return { ok: false, reason: "transfer_limit", error: "This ticket cannot be transferred again." };
  }
  if (input.price < 0n) {
    return { ok: false, reason: "invalid_price", error: "Enter a valid price." };
  }
  if (input.price > input.resaleCap) {
    return {
      ok: false,
      reason: "cap_exceeded",
      error: "That price is above the organizer’s resale cap.",
    };
  }
  return { ok: true };
}

export function resaleOwnerPatch(input: {
  buyerUserId: string | null;
  buyerPublicKey: string | null;
  sellerPublicKey: string;
  currentTransfers: number;
}) {
  return {
    owner_user_id: input.buyerUserId,
    owner_public_key: input.buyerPublicKey ?? input.sellerPublicKey,
    transfers: input.currentTransfers + 1,
  };
}

export function refundAllowed(input: {
  eventStatus?: string | null;
  refunded?: boolean;
  owner: string;
  wallet: string;
}): { ok: true } | { ok: false; error: string } {
  if (input.eventStatus !== "Cancelled") {
    return { ok: false, error: "Refunds are only available after the organizer cancels." };
  }
  if (input.refunded) return { ok: false, error: "This ticket was already refunded." };
  if (input.owner !== input.wallet) {
    return { ok: false, error: "Sign with the wallet that holds this ticket." };
  }
  return { ok: true };
}
