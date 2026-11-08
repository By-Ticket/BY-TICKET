import type { AnchorToml } from "./toml";
import { mapSep24Status } from "./status";
import type { OffRampRequest, OnRampRequest, PaymentRampAdapter, RampProvider, RampSession, RampStatus } from "./ramp";

export class AssetNotOfferedError extends Error {
  constructor(assetCode: string, kind: "deposit" | "withdraw") {
    super(`This anchor does not offer ${assetCode} for ${kind}.`);
    this.name = "AssetNotOfferedError";
  }
}

export interface Sep24Info {
  deposit: Record<string, { enabled?: boolean }>;
  withdraw: Record<string, { enabled?: boolean }>;
}

export interface Sep24Transaction {
  id: string;
  kind: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  started_at?: string;
  completed_at?: string;
  more_info_url?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
}

export interface InteractiveStart {
  id: string;
  url: string;
}

function authHeaders(jwt: string): HeadersInit {
  return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/x-www-form-urlencoded" };
}

export function assetEnabled(info: Sep24Info, kind: "deposit" | "withdraw", assetCode: string): boolean {
  const entry = info[kind]?.[assetCode];
  return Boolean(entry?.enabled);
}

/** /info is keyed by code; stellar.toml lists issuers. Both must match the ticket asset. */
export function anchorOffersAsset(
  info: Sep24Info,
  toml: AnchorToml,
  kind: "deposit" | "withdraw",
  asset: { code: string; issuer?: string },
): boolean {
  if (!assetEnabled(info, kind, asset.code)) return false;
  if (!asset.issuer) return true;
  const listed = toml.currencies.filter((currency) => currency.code === asset.code);
  if (listed.length === 0) return true;
  return listed.some((currency) => currency.issuer === asset.issuer);
}

export async function fetchSep24Info(
  toml: AnchorToml,
  jwt?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sep24Info> {
  const headers: HeadersInit = jwt ? { Authorization: `Bearer ${jwt}` } : {};
  const response = await fetchImpl(`${toml.transferServerSep24}/info`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`The anchor /info endpoint failed (${response.status}).`);
  return (await response.json()) as Sep24Info;
}

export async function startInteractive(
  toml: AnchorToml,
  jwt: string,
  kind: "deposit" | "withdraw",
  params: { assetCode: string; assetIssuer?: string; account: string; amount?: string; lang?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<InteractiveStart> {
  const body = new URLSearchParams({
    asset_code: params.assetCode,
    account: params.account,
    lang: params.lang ?? "en",
  });
  if (params.amount) body.set("amount", params.amount);
  if (params.assetIssuer) body.set("asset_issuer", params.assetIssuer);
  const response = await fetchImpl(`${toml.transferServerSep24}/transactions/${kind}/interactive`, {
    method: "POST",
    headers: authHeaders(jwt),
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`The anchor did not start the ${kind} (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { type?: string; url?: string; id?: string };
  if (!data.url || !data.id) throw new Error("The anchor did not return an interactive URL.");
  return { id: data.id, url: data.url };
}

export async function fetchSep24Transaction(
  toml: AnchorToml,
  jwt: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sep24Transaction> {
  const url = new URL(`${toml.transferServerSep24}/transaction`);
  url.searchParams.set("id", id);
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${jwt}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the anchor transfer (${response.status}).`);
  const data = (await response.json()) as { transaction?: Sep24Transaction };
  if (!data.transaction) throw new Error("The anchor returned an empty transfer.");
  return data.transaction;
}

function toSession(
  provider: RampProvider,
  reference: string,
  tx: { id: string; status: string; url?: string },
): RampSession {
  return {
    provider,
    reference,
    providerReference: tx.id,
    status: mapSep24Status(tx.status),
    interactiveUrl: tx.url,
    instructions: undefined,
  };
}

/** Parse an Anchor Platform SEP-24 transaction callback body (after signature checks). */
export function parseSep24Webhook(rawBody: string): RampSession {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error("Webhook is not JSON.");
  }
  const tx = (body.transaction && typeof body.transaction === "object" ? body.transaction : body) as {
    id?: unknown;
    status?: unknown;
    url?: unknown;
    amount_in?: unknown;
    amount_out?: unknown;
    withdraw_anchor_account?: unknown;
    withdraw_memo?: unknown;
    withdraw_memo_type?: unknown;
  };
  if (typeof tx.id !== "string" || typeof tx.status !== "string") {
    throw new Error("Webhook is missing a transaction id or status.");
  }
  return {
    provider: "sep24",
    reference: tx.id,
    providerReference: tx.id,
    status: mapSep24Status(tx.status),
    interactiveUrl: typeof tx.url === "string" ? tx.url : undefined,
    amountIn: typeof tx.amount_in === "string" ? tx.amount_in : undefined,
    amountOut: typeof tx.amount_out === "string" ? tx.amount_out : undefined,
    withdrawAccount: typeof tx.withdraw_anchor_account === "string" ? tx.withdraw_anchor_account : undefined,
    withdrawMemo: typeof tx.withdraw_memo === "string" ? tx.withdraw_memo : undefined,
    withdrawMemoType: typeof tx.withdraw_memo_type === "string" ? tx.withdraw_memo_type : undefined,
  };
}

/**
 * SEP-24 adapter. Interactive URL + JWT live on the caller; this class talks to the anchor.
 * Status is polled via `getStatus`; `parseWebhook` handles Anchor Platform callbacks.
 */
export class Sep24RampAdapter implements PaymentRampAdapter {
  readonly provider = "sep24" as const;

  constructor(
    private readonly toml: AnchorToml,
    private readonly jwt: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async assertAsset(kind: "deposit" | "withdraw", asset: { code: string; issuer?: string }): Promise<void> {
    const info = await fetchSep24Info(this.toml, this.jwt, this.fetchImpl);
    if (!anchorOffersAsset(info, this.toml, kind, asset)) {
      throw new AssetNotOfferedError(asset.code, kind);
    }
  }

  async startOnRamp(req: OnRampRequest): Promise<RampSession> {
    const assetCode = req.assetCode ?? "USDC";
    await this.assertAsset("deposit", { code: assetCode, issuer: req.assetIssuer });
    const started = await startInteractive(
      this.toml,
      this.jwt,
      "deposit",
      {
        assetCode,
        assetIssuer: req.assetIssuer,
        account: req.destination,
        amount: req.amountUsdc,
      },
      this.fetchImpl,
    );
    return toSession(this.provider, req.reference, { id: started.id, status: "incomplete", url: started.url });
  }

  async startOffRamp(req: OffRampRequest): Promise<RampSession> {
    const assetCode = req.assetCode ?? "USDC";
    await this.assertAsset("withdraw", { code: assetCode, issuer: req.assetIssuer });
    const started = await startInteractive(
      this.toml,
      this.jwt,
      "withdraw",
      {
        assetCode,
        assetIssuer: req.assetIssuer,
        account: req.sourceAccount ?? req.phone,
        amount: req.amountUsdc,
      },
      this.fetchImpl,
    );
    return toSession(this.provider, req.reference, { id: started.id, status: "incomplete", url: started.url });
  }

  async getStatus(reference: string): Promise<RampSession> {
    const tx = await fetchSep24Transaction(this.toml, this.jwt, reference, this.fetchImpl);
    return {
      ...toSession(this.provider, reference, tx),
      withdrawAccount: tx.withdraw_anchor_account,
      withdrawMemo: tx.withdraw_memo,
      withdrawMemoType: tx.withdraw_memo_type,
      amountIn: tx.amount_in,
      amountOut: tx.amount_out,
    };
  }

  async parseWebhook(_headers: Headers, rawBody: string): Promise<RampSession> {
    return parseSep24Webhook(rawBody);
  }
}

export function sessionNeedsPayment(status: RampStatus, withdrawAccount?: string): boolean {
  return status === "awaiting_customer" && Boolean(withdrawAccount);
}
