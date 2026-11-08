"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth/session";
import { requestAppHost } from "@/lib/http/request-host";
import { limitAction } from "@/lib/security/action-guard";
import { stellarConfig } from "@/lib/stellar/config";
import {
  WALLET_CHALLENGE_TTL_MS,
  verifyWalletSignature,
  walletChallengeMessage,
} from "@/lib/stellar/wallet-proof";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import { stellarAccountSchema } from "@/lib/validation/account";

const MAX_FREIGHTER_WALLETS = 3;
const UNAVAILABLE = "Wallet linking isn't available right now. Please try again later.";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Step 1: issue a one-time message for the wallet to sign. */
export async function createWalletChallenge(
  publicKey: string,
): Promise<Result<{ challengeId: string; message: string }>> {
  const viewer = await requireViewer("/account");
  const parsed = stellarAccountSchema.safeParse(publicKey);
  if (!parsed.success) return { ok: false, error: "That wallet returned an invalid address." };

  const limited = await limitAction("wallet-challenge", { limit: 10, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  const admin = createSupabaseAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("wallets")
    .select("user_id")
    .eq("public_key", parsed.data)
    .maybeSingle();
  if (lookupError) {
    console.error("wallet lookup failed", { code: lookupError.code });
    return { ok: false, error: UNAVAILABLE };
  }
  if (existing) {
    return {
      ok: false,
      error:
        existing.user_id === viewer.id
          ? "This wallet is already linked to your account."
          : "This wallet is linked to another BY Tickets account.",
    };
  }

  const { count } = await admin
    .from("wallets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", viewer.id)
    .eq("kind", "freighter");
  if ((count ?? 0) >= MAX_FREIGHTER_WALLETS) {
    return { ok: false, error: `You can link up to ${MAX_FREIGHTER_WALLETS} Stellar wallets. Remove one first.` };
  }

  await admin.from("wallet_challenges").delete().eq("user_id", viewer.id).lt("expires_at", new Date().toISOString());

  const nonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + WALLET_CHALLENGE_TTL_MS);
  const { data: challenge, error } = await admin
    .from("wallet_challenges")
    .insert({
      user_id: viewer.id,
      public_key: parsed.data,
      nonce,
      expires_at: expiresAt.toISOString(),
      purpose: "link",
    })
    .select("id")
    .single();
  if (error) {
    console.error("wallet challenge insert failed", { code: error.code });
    return { ok: false, error: UNAVAILABLE };
  }

  const message = walletChallengeMessage({
    purpose: "link",
      domain: await requestAppHost(),
    publicKey: parsed.data,
    networkPassphrase: stellarConfig.networkPassphrase,
    nonce,
    expiresAt,
  });
  return { ok: true, challengeId: challenge.id, message };
}

const verifySchema = z.object({
  challengeId: z.uuid(),
  signature: z.string().trim().min(64).max(200),
});

/** Step 2: check the signature and link the wallet. Each challenge can be used once. */
export async function verifyWalletChallenge(input: { challengeId: string; signature: string }): Promise<Result> {
  const viewer = await requireViewer("/account");
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The wallet returned an invalid signature." };

  const limited = await limitAction("wallet-verify", { limit: 10, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  // Claiming the challenge in one conditional UPDATE makes replays and parallel submissions fail.
  const { data: challenge, error: claimError } = await admin
    .from("wallet_challenges")
    .update({ used_at: now })
    .eq("id", parsed.data.challengeId)
    .eq("user_id", viewer.id)
    .eq("purpose", "link")
    .is("used_at", null)
    .gt("expires_at", now)
    .select("public_key, nonce, expires_at")
    .maybeSingle();
  if (claimError) {
    console.error("wallet challenge claim failed", { code: claimError.code });
    return { ok: false, error: UNAVAILABLE };
  }
  if (!challenge) return { ok: false, error: "That request expired. Please connect again." };

  const message = walletChallengeMessage({
    purpose: "link",
      domain: await requestAppHost(),
    publicKey: challenge.public_key,
    networkPassphrase: stellarConfig.networkPassphrase,
    nonce: challenge.nonce,
    expiresAt: new Date(challenge.expires_at),
  });
  if (!verifyWalletSignature(challenge.public_key, message, parsed.data.signature)) {
    return { ok: false, error: "The signature didn't match this wallet. Please try again." };
  }

  const { data: wallet, error: insertError } = await admin
    .from("wallets")
    .insert({ user_id: viewer.id, kind: "freighter", public_key: challenge.public_key, verified_at: now })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return { ok: false, error: "This wallet is already linked to an account." };
    console.error("wallet insert failed", { code: insertError.code });
    return { ok: false, error: UNAVAILABLE };
  }

  await admin.from("audit_log").insert({
    actor_id: viewer.id,
    action: "wallet.link",
    entity: "wallet",
    entity_id: wallet.id,
    data: { kind: "freighter", public_key: challenge.public_key },
  });
  revalidatePath("/account");
  return { ok: true };
}

/** Unlink a Freighter wallet. The custodial wallet holds platform-managed assets and stays. */
export async function removeFreighterWallet(walletId: string): Promise<Result> {
  const viewer = await requireViewer("/account");
  if (!z.uuid().safeParse(walletId).success) return { ok: false, error: "Unknown wallet." };

  const limited = await limitAction("wallet-remove", { limit: 10, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  const admin = createSupabaseAdminClient();
  const { data: removed, error } = await admin
    .from("wallets")
    .delete()
    .eq("id", walletId)
    .eq("user_id", viewer.id)
    .eq("kind", "freighter")
    .eq("is_primary", false)
    .select("public_key")
    .maybeSingle();
  if (error) {
    console.error("wallet remove failed", { code: error.code });
    return { ok: false, error: UNAVAILABLE };
  }
  if (!removed) return { ok: false, error: "That wallet can't be removed." };

  await admin.from("audit_log").insert({
    actor_id: viewer.id,
    action: "wallet.unlink",
    entity: "wallet",
    entity_id: walletId,
    data: { kind: "freighter", public_key: removed.public_key },
  });
  revalidatePath("/account");
  return { ok: true };
}
