import { createHash } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;

export type WalletChallengePurpose = "link" | "login";

export interface WalletChallenge {
  purpose?: WalletChallengePurpose;
  domain: string;
  publicKey: string;
  networkPassphrase: string;
  nonce: string;
  expiresAt: Date;
}

/**
 * The exact text the wallet signs. Binding the domain, network, purpose and expiry means a
 * signature collected by another site, for another network, or after expiry never works here.
 */
export function walletChallengeMessage(c: WalletChallenge): string {
  const headline =
    c.purpose === "login"
      ? "BY Tickets: sign in with this Stellar wallet."
      : "BY Tickets: link this Stellar wallet to your account.";
  return [
    headline,
    "Only sign this on the BY Tickets website. It does not move any funds.",
    "",
    `Domain: ${c.domain}`,
    `Wallet: ${c.publicKey}`,
    `Network: ${c.networkPassphrase}`,
    `Nonce: ${c.nonce}`,
    `Expires: ${c.expiresAt.toISOString()}`,
  ].join("\n");
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

/** SEP-53 signed-message hash: SHA-256("Stellar Signed Message:\n" + message). */
export function sep53Hash(message: string): Buffer {
  return sha256(Buffer.concat([Buffer.from("Stellar Signed Message:\n", "utf8"), Buffer.from(message, "utf8")]));
}

/** Decode a signature sent as base64 or hex; null unless it is a 64-byte ed25519 signature. */
export function decodeSignature(signature: string): Buffer | null {
  const s = signature.trim();
  const raw = /^[0-9a-f]{128}$/i.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  return raw.length === 64 ? raw : null;
}

/**
 * Verify a wallet signature over `message`. Current Freighter signs the SEP-53 hash; older
 * releases signed SHA-256(message); some wallets sign the UTF-8 bytes. All cover the full
 * challenge text, so any of them proves control.
 */
export function verifyWalletSignature(publicKey: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) return false;
  const sig = decodeSignature(signature);
  if (!sig) return false;
  const keypair = Keypair.fromPublicKey(publicKey);
  const payload = Buffer.from(message, "utf8");
  try {
    return (
      keypair.verify(sep53Hash(message), sig) ||
      keypair.verify(sha256(payload), sig) ||
      keypair.verify(payload, sig)
    );
  } catch {
    return false;
  }
}
