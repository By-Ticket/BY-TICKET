import { Keypair, Transaction, WebAuth } from "@stellar/stellar-sdk";
import { stellarConfig } from "@/lib/stellar/config";
import type { AnchorToml } from "./toml";

export class Sep10Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sep10Error";
  }
}

export interface Sep10Challenge {
  transaction: string;
  networkPassphrase: string;
}

/** Request a SEP-10 challenge from the anchor's WEB_AUTH_ENDPOINT. */
export async function requestSep10Challenge(
  toml: AnchorToml,
  account: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Sep10Challenge> {
  const url = new URL(toml.webAuthEndpoint);
  url.searchParams.set("account", account);
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Sep10Error(`The anchor did not issue a sign-in challenge (${response.status}).`);
  }
  const body = (await response.json()) as { transaction?: string; network_passphrase?: string };
  if (!body.transaction) throw new Sep10Error("The anchor challenge was empty.");
  verifySep10Challenge(body.transaction, toml, account);
  return {
    transaction: body.transaction,
    networkPassphrase: body.network_passphrase ?? stellarConfig.networkPassphrase,
  };
}

/**
 * Confirm the challenge was produced by the anchor's SIGNING_KEY and is for this account
 * and home domain. Does not require the client signature yet.
 */
export function verifySep10Challenge(challengeXdr: string, toml: AnchorToml, account: string): Transaction {
  try {
    const network = toml.networkPassphrase ?? stellarConfig.networkPassphrase;
    const { tx, clientAccountID } = WebAuth.readChallengeTx(
      challengeXdr,
      toml.signingKey,
      network,
      toml.homeDomain,
      new URL(toml.webAuthEndpoint).host,
    );
    if (clientAccountID !== account) {
      throw new Sep10Error("The challenge is for a different Stellar account.");
    }
    return tx;
  } catch (error) {
    if (error instanceof Sep10Error) throw error;
    const message = error instanceof Error ? error.message : "Invalid SEP-10 challenge";
    throw new Sep10Error(message);
  }
}

/** After the wallet signs, confirm both the server and the client signed, then swap for a JWT. */
export async function exchangeSep10Token(
  toml: AnchorToml,
  signedXdr: string,
  account: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; expiresAt: Date }> {
  verifySep10Challenge(signedXdr, toml, account);
  try {
    WebAuth.verifyChallengeTxSigners(
      signedXdr,
      toml.signingKey,
      toml.networkPassphrase ?? stellarConfig.networkPassphrase,
      [account],
      toml.homeDomain,
      new URL(toml.webAuthEndpoint).host,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Challenge signatures were rejected";
    throw new Sep10Error(message);
  }

  const response = await fetchImpl(toml.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXdr }),
  });
  if (!response.ok) {
    throw new Sep10Error(`The anchor rejected the signed challenge (${response.status}).`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Sep10Error("The anchor did not return a session token.");
  return { token: body.token, expiresAt: jwtExpiry(body.token) };
}

export function signChallengeXdr(challengeXdr: string, keypair: Keypair, networkPassphrase: string): string {
  const tx = new Transaction(challengeXdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

function jwtExpiry(token: string): Date {
  const parts = token.split(".");
  if (parts.length < 2) return new Date(Date.now() + 15 * 60_000);
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number") return new Date(payload.exp * 1000);
  } catch {
    // Anchor tokens are opaque to us beyond expiry; fall back to 15 minutes.
  }
  return new Date(Date.now() + 15 * 60_000);
}
