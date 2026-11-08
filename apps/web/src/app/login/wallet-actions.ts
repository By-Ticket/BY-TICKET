"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { afterSignIn } from "@/lib/auth/bootstrap";
import { safeNextPath } from "@/lib/auth/redirect";
import { stellarWalletEmail } from "@/lib/auth/stellar-wallet";
import { requestAppHost } from "@/lib/http/request-host";
import { limitAction } from "@/lib/security/action-guard";
import { stellarConfig } from "@/lib/stellar/config";
import {
  WALLET_CHALLENGE_TTL_MS,
  verifyWalletSignature,
  walletChallengeMessage,
} from "@/lib/stellar/wallet-proof";
import { createSupabaseAdminClient, createSupabaseServerClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import { stellarAccountSchema } from "@/lib/validation/account";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UNAVAILABLE = "Wallet sign-in isn't available right now. Please try again later.";

export async function createLoginChallenge(
  publicKey: string,
): Promise<Result<{ challengeId: string; message: string }>> {
  const parsed = stellarAccountSchema.safeParse(publicKey);
  if (!parsed.success) return { ok: false, error: "That wallet returned an invalid address." };

  const limited = await limitAction("wallet-login-challenge", {
    limit: 8,
    windowMs: 15 * 60_000,
    subject: parsed.data,
  });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  const admin = createSupabaseAdminClient();
  await admin
    .from("wallet_challenges")
    .delete()
    .eq("purpose", "login")
    .eq("public_key", parsed.data)
    .lt("expires_at", new Date().toISOString());

  const nonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + WALLET_CHALLENGE_TTL_MS);
  const { data: challenge, error } = await admin
    .from("wallet_challenges")
    .insert({
      user_id: null,
      public_key: parsed.data,
      nonce,
      expires_at: expiresAt.toISOString(),
      purpose: "login",
    })
    .select("id")
    .single();
  if (error) {
    console.error("wallet login challenge insert failed", { code: error.code });
    return { ok: false, error: UNAVAILABLE };
  }

  return {
    ok: true,
    challengeId: challenge.id,
    message: walletChallengeMessage({
      purpose: "login",
      domain: await requestAppHost(),
      publicKey: parsed.data,
      networkPassphrase: stellarConfig.networkPassphrase,
      nonce,
      expiresAt,
    }),
  };
}

const verifySchema = z.object({
  challengeId: z.uuid(),
  signature: z.string().trim().min(64).max(200),
  next: z.string().optional(),
});

async function establishSession(email: string): Promise<{ id: string; email?: string | null } | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("wallet login generateLink failed", { code: error?.code });
    return null;
  }
  const supabase = await createSupabaseServerClient();
  const { data: session, error: verifyError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (verifyError || !session.user) {
    console.error("wallet login verifyOtp failed", { code: verifyError?.code });
    return null;
  }
  return session.user;
}

async function userEmail(userId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    console.error("wallet login getUserById failed", { code: error?.code });
    return null;
  }
  return data.user.email;
}

export async function completeWalletLogin(input: {
  challengeId: string;
  signature: string;
  next?: string;
}): Promise<Result> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The wallet returned an invalid signature." };
  const next = safeNextPath(parsed.data.next, "/tickets");

  const limited = await limitAction("wallet-login-verify", {
    limit: 8,
    windowMs: 15 * 60_000,
    subject: parsed.data.challengeId,
  });
  if (limited) return { ok: false, error: limited };
  if (!supabaseAdminConfigured) return { ok: false, error: UNAVAILABLE };

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: challenge, error: claimError } = await admin
    .from("wallet_challenges")
    .update({ used_at: now })
    .eq("id", parsed.data.challengeId)
    .eq("purpose", "login")
    .is("user_id", null)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("public_key, nonce, expires_at")
    .maybeSingle();
  if (claimError) {
    console.error("wallet login challenge claim failed", { code: claimError.code });
    return { ok: false, error: UNAVAILABLE };
  }
  if (!challenge) return { ok: false, error: "That request expired. Please connect again." };

  const message = walletChallengeMessage({
    purpose: "login",
    domain: await requestAppHost(),
    publicKey: challenge.public_key,
    networkPassphrase: stellarConfig.networkPassphrase,
    nonce: challenge.nonce,
    expiresAt: new Date(challenge.expires_at),
  });
  if (!verifyWalletSignature(challenge.public_key, message, parsed.data.signature)) {
    return { ok: false, error: "The signature didn't match this wallet. Please try again." };
  }

  const { data: existing, error: lookupError } = await admin
    .from("wallets")
    .select("user_id")
    .eq("public_key", challenge.public_key)
    .maybeSingle();
  if (lookupError) {
    console.error("wallet login lookup failed", { code: lookupError.code });
    return { ok: false, error: UNAVAILABLE };
  }

  let email: string | null = null;
  let userId: string | null = existing?.user_id ?? null;

  if (userId) {
    email = await userEmail(userId);
  } else {
    const created = await admin.auth.admin.createUser({
      email: stellarWalletEmail(challenge.public_key),
      email_confirm: true,
      user_metadata: {
        auth_method: "stellar_wallet",
        stellar_public_key: challenge.public_key,
        display_name: `${challenge.public_key.slice(0, 6)}…${challenge.public_key.slice(-6)}`,
      },
    });
    if (created.error || !created.data.user) {
      console.error("wallet login createUser failed", { code: created.error?.code });
      return { ok: false, error: UNAVAILABLE };
    }
    userId = created.data.user.id;
    email = created.data.user.email ?? stellarWalletEmail(challenge.public_key);
    const { error: insertError } = await admin.from("wallets").insert({
      user_id: userId,
      kind: "freighter",
      public_key: challenge.public_key,
      verified_at: now,
    });
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: winner } = await admin
          .from("wallets")
          .select("user_id")
          .eq("public_key", challenge.public_key)
          .maybeSingle();
        if (winner) {
          await admin.auth.admin.deleteUser(userId);
          userId = winner.user_id;
          email = await userEmail(winner.user_id);
        } else {
          console.error("wallet login insert raced and vanished", { code: insertError.code });
          return { ok: false, error: UNAVAILABLE };
        }
      } else {
        console.error("wallet login insert failed", { code: insertError.code });
        return { ok: false, error: UNAVAILABLE };
      }
    } else {
      await admin.from("audit_log").insert({
        actor_id: userId,
        action: "wallet.login",
        entity: "wallet",
        data: { kind: "freighter", public_key: challenge.public_key },
      });
    }
  }

  if (!email) return { ok: false, error: UNAVAILABLE };
  const user = await establishSession(email);
  if (!user) return { ok: false, error: UNAVAILABLE };
  await afterSignIn(user);
  redirect(next);
}
