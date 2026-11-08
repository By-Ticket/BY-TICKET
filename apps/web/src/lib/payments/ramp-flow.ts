import "server-only";
import { AssetNotOfferedError, anchorOffersAsset, fetchSep24Info } from "./sep24";
import { exchangeSep10Token, requestSep10Challenge, signChallengeXdr } from "./sep10";
import { clearSep10Session, readSep10Session, writeSep10Session } from "./sep10-cookie";
import { defaultAnchorHomeDomain, rampProvider } from "./ramp";
import { fetchStellarToml } from "./toml";
import { custodialKeypair } from "@/lib/custodial/keys";
import { stellarConfig } from "@/lib/stellar/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { RampStatus } from "./ramp";

type RampRow = Database["public"]["Tables"]["ramp_transactions"]["Row"];

export type Sep10Needed = { step: "sep10"; challengeXdr: string; address: string; homeDomain: string };

export async function ticketAsset(): Promise<{ code: string; issuer?: string }> {
  return { code: stellarConfig.usdc.code, issuer: stellarConfig.usdc.issuer };
}

export async function ensureAnchorOffers(kind: "deposit" | "withdraw", jwt?: string): Promise<string | null> {
  const domain = defaultAnchorHomeDomain();
  if (!domain) return "Set ANCHOR_HOME_DOMAIN to use local-currency payments.";
  const toml = await fetchStellarToml(domain);
  const info = await fetchSep24Info(toml, jwt);
  const asset = await ticketAsset();
  if (anchorOffersAsset(info, toml, kind, asset)) return null;
  const label = asset.issuer ? `${asset.code} issued by ${asset.issuer.slice(0, 4)}…${asset.issuer.slice(-4)}` : asset.code;
  return `This anchor does not offer ${label} for ${kind === "deposit" ? "buying tickets" : "cash-out"}. Try a Stellar wallet, or point ANCHOR_HOME_DOMAIN at an anchor that lists that asset.`;
}

export async function ensureSep10(
  wallet: { id: string; kind: "custodial" | "freighter"; public_key: string },
): Promise<{ jwt: string } | Sep10Needed> {
  const domain = defaultAnchorHomeDomain();
  if (!domain) throw new Error("Set ANCHOR_HOME_DOMAIN for the SEP-24 ramp.");
  const existing = await readSep10Session();
  if (existing && existing.account === wallet.public_key && existing.homeDomain === domain) {
    return { jwt: existing.token };
  }
  if (existing) await clearSep10Session();

  const toml = await fetchStellarToml(domain);
  const challenge = await requestSep10Challenge(toml, wallet.public_key);
  if (wallet.kind === "custodial") {
    const keypair = await custodialKeypair(wallet.id, wallet.public_key);
    const signed = signChallengeXdr(challenge.transaction, keypair, challenge.networkPassphrase);
    const token = await exchangeSep10Token(toml, signed, wallet.public_key);
    await writeSep10Session({
      token: token.token,
      account: wallet.public_key,
      homeDomain: domain,
      expiresAt: token.expiresAt.toISOString(),
    });
    return { jwt: token.token };
  }
  return {
    step: "sep10",
    challengeXdr: challenge.transaction,
    address: wallet.public_key,
    homeDomain: domain,
  };
}

export async function completeSep10ForWallet(
  wallet: { public_key: string },
  signedXdr: string,
): Promise<string> {
  const domain = defaultAnchorHomeDomain();
  const toml = await fetchStellarToml(domain);
  const token = await exchangeSep10Token(toml, signedXdr, wallet.public_key);
  await writeSep10Session({
    token: token.token,
    account: wallet.public_key,
    homeDomain: domain,
    expiresAt: token.expiresAt.toISOString(),
  });
  return token.token;
}

export async function insertRampTx(row: Database["public"]["Tables"]["ramp_transactions"]["Insert"]): Promise<RampRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ramp_transactions").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateRampTx(
  id: string,
  userId: string,
  patch: Database["public"]["Tables"]["ramp_transactions"]["Update"],
): Promise<RampRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ramp_transactions").update(patch).eq("id", id).eq("user_id", userId).select("*").single();
  if (error) throw error;
  return data;
}

export async function loadRampTx(id: string, userId: string): Promise<RampRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("ramp_transactions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

export function persistStatus(status: RampStatus): Database["public"]["Enums"]["ramp_tx_status"] {
  return status;
}

export { rampProvider, AssetNotOfferedError };
