/**
 * Fiat on/off-ramp boundary. Ticket minting waits until `getStatus` reports `settled`
 * and the USDC has landed. Mobile-money brands (MTN, Airtel, Zamtel) stay as metadata
 * for future anchors — see `providers.ts`.
 */

import { serverEnv } from "@/lib/env.server";
import { stellarConfig } from "@/lib/stellar/config";
import { fetchStellarToml } from "./toml";
import { Sep24RampAdapter } from "./sep24";

export type RampProvider = "stub" | "sep24" | "mtn_momo" | "airtel_money" | "zamtel_kwacha";

export type RampStatus =
  | "pending"
  | "awaiting_customer"
  | "settled"
  | "failed"
  | "error"
  | "refunded"
  | "expired";

export interface OnRampRequest {
  /** Our idempotency key; providers must de-duplicate on it. */
  reference: string;
  /** Amount the customer pays, in ngwee (ZMW minor units). */
  amountNgwee: bigint;
  /** Optional USDC amount string (7 decimals) for SEP-24. */
  amountUsdc?: string;
  assetCode?: string;
  /** MSISDN in E.164, e.g. +260971234567. */
  phone: string;
  /** Stellar account (G...) or contract (C...) that receives the USDC. */
  destination: string;
}

export interface OffRampRequest {
  reference: string;
  /** USDC to pay out, in 7-decimal units. */
  amountUsdcUnits: bigint;
  /** Human-readable USDC amount for SEP-24. */
  amountUsdc?: string;
  assetCode?: string;
  sourceAccount?: string;
  phone: string;
}

export interface RampSession {
  provider: RampProvider;
  reference: string;
  providerReference: string;
  status: RampStatus;
  /** Shown to the user, e.g. "Approve the prompt on your phone". */
  instructions?: string;
  interactiveUrl?: string;
  withdrawAccount?: string;
  withdrawMemo?: string;
  withdrawMemoType?: string;
  amountIn?: string;
  amountOut?: string;
}

export type RampAdapter = PaymentRampAdapter;

export interface PaymentRampAdapter {
  readonly provider: RampProvider;
  startOnRamp(req: OnRampRequest): Promise<RampSession>;
  startOffRamp(req: OffRampRequest): Promise<RampSession>;
  getStatus(reference: string): Promise<RampSession>;
  /** Verify and parse a provider webhook. Must reject bad signatures. */
  parseWebhook(headers: Headers, rawBody: string): Promise<RampSession>;
}

/** In-memory stub: every request settles immediately. Testnet/dev only. */
export class StubRampAdapter implements PaymentRampAdapter {
  readonly provider = "stub" as const;
  private sessions = new Map<string, RampSession>();

  async startOnRamp(req: OnRampRequest): Promise<RampSession> {
    return this.settle(req.reference, "Stub: payment auto-approved");
  }

  async startOffRamp(req: OffRampRequest): Promise<RampSession> {
    return this.settle(req.reference, "Stub: payout auto-sent");
  }

  async getStatus(reference: string): Promise<RampSession> {
    const session = this.sessions.get(reference);
    if (!session) throw new Error(`Unknown ramp reference: ${reference}`);
    return session;
  }

  async parseWebhook(): Promise<RampSession> {
    throw new Error("Stub ramp adapter does not receive webhooks");
  }

  private settle(reference: string, instructions: string): RampSession {
    const existing = this.sessions.get(reference);
    if (existing) return existing;
    const session: RampSession = {
      provider: this.provider,
      reference,
      providerReference: `stub_${reference}`,
      status: "settled",
      instructions,
    };
    this.sessions.set(reference, session);
    return session;
  }
}

export function rampProvider(): RampProvider {
  return serverEnv.RAMP_PROVIDER;
}

export function defaultAnchorHomeDomain(): string {
  return serverEnv.ANCHOR_HOME_DOMAIN ?? (stellarConfig.isTestnet ? "testanchor.stellar.org" : "");
}

export async function createRampAdapter(provider: RampProvider = rampProvider(), jwt?: string): Promise<PaymentRampAdapter> {
  switch (provider) {
    case "stub":
      return new StubRampAdapter();
    case "sep24": {
      const domain = defaultAnchorHomeDomain();
      if (!domain) throw new Error("Set ANCHOR_HOME_DOMAIN for the SEP-24 ramp.");
      if (!jwt) throw new Error("Sign in with the Stellar wallet at the anchor first.");
      const toml = await fetchStellarToml(domain);
      return new Sep24RampAdapter(toml, jwt);
    }
    default:
      throw new Error(`Payment ramp provider "${provider}" is not implemented yet (see docs/ROADMAP.md)`);
  }
}
