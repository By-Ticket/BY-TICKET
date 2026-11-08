import type { RampStatus } from "./ramp";

/** SEP-24 transaction.status values we handle in the UI. */
export type Sep24Status =
  | "incomplete"
  | "pending_user"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_external"
  | "pending_trust"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "completed"
  | "refunded"
  | "expired"
  | "error"
  | "no_market"
  | "too_small"
  | "too_large";

const SETTLED: Sep24Status[] = ["completed"];
const AWAITING: Sep24Status[] = ["incomplete", "pending_user", "pending_user_transfer_start", "pending_trust"];
const PENDING: Sep24Status[] = [
  "pending_anchor",
  "pending_stellar",
  "pending_external",
  "pending_user_transfer_complete",
];
const FAILED: Sep24Status[] = ["error", "no_market", "too_small", "too_large"];

export function mapSep24Status(status: string): RampStatus {
  const value = status.toLowerCase() as Sep24Status;
  if (SETTLED.includes(value)) return "settled";
  if (value === "refunded") return "refunded";
  if (value === "expired") return "expired";
  if (AWAITING.includes(value)) return "awaiting_customer";
  if (PENDING.includes(value)) return "pending";
  if (FAILED.includes(value)) return "error";
  return "pending";
}

export function rampStatusMessage(status: RampStatus): string {
  switch (status) {
    case "settled":
      return "The transfer completed.";
    case "awaiting_customer":
      return "Finish the steps in the anchor window.";
    case "pending":
      return "The anchor is still processing this transfer.";
    case "refunded":
      return "This transfer was refunded.";
    case "expired":
      return "This transfer expired. Start again.";
    case "error":
    case "failed":
      return "The transfer failed. Try again or use a Stellar wallet.";
    default:
      return "Waiting on the anchor.";
  }
}

export function isTerminalRampStatus(status: RampStatus): boolean {
  return status === "settled" || status === "failed" || status === "error" || status === "expired" || status === "refunded";
}
