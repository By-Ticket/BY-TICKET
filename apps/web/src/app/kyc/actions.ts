"use server";

import { requireViewer } from "@/lib/auth/session";
import { refreshKyc, submitKycFields } from "@/lib/payments/kyc-flow";
import type { KycField, KycGate } from "@/lib/payments/kyc-status";
import { completeSep10ForWallet, ensureSep10 } from "@/lib/payments/ramp-flow";
import { limitAction } from "@/lib/security/action-guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type KycActionResult =
  | { ok: true; step: "sep10"; challengeXdr: string; address: string; homeDomain: string }
  | { ok: true; step: "kyc"; status: string; message: string; fields: KycField[] }
  | { ok: true; step: "kyc_pending"; message: string }
  | { ok: true; step: "ready" }
  | { ok: false; error: string };

function fromGate(gate: KycGate): KycActionResult {
  if (gate.action === "allow") return { ok: true, step: "ready" };
  if (gate.action === "block") return { ok: false, error: gate.message };
  if (gate.action === "pending") return { ok: true, step: "kyc_pending", message: gate.message };
  return { ok: true, step: "kyc", status: gate.status, message: gate.message, fields: gate.fields };
}

async function ownWallet(userId: string, walletId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("wallets").select("id, user_id, kind, public_key").eq("id", walletId).maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data;
}

export async function checkKyc(input: {
  walletId: string;
  kind: "deposit" | "withdraw";
  amountUsdc: number;
}): Promise<KycActionResult> {
  const viewer = await requireViewer("/");
  const wallet = await ownWallet(viewer.id, input.walletId);
  if (!wallet) return { ok: false, error: "Choose one of your wallets." };
  const auth = await ensureSep10(wallet);
  if ("step" in auth) {
    return { ok: true, step: "sep10", challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
  }
  try {
    return fromGate(
      await refreshKyc({
        userId: viewer.id,
        account: wallet.public_key,
        jwt: auth.jwt,
        kind: input.kind,
        amountUsdc: input.amountUsdc,
      }),
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not check identity verification." };
  }
}

export async function finishSep10Kyc(input: {
  walletId: string;
  signedXdr: string;
  kind: "deposit" | "withdraw";
  amountUsdc: number;
}): Promise<KycActionResult> {
  const viewer = await requireViewer("/");
  const wallet = await ownWallet(viewer.id, input.walletId);
  if (!wallet) return { ok: false, error: "Choose one of your wallets." };
  await completeSep10ForWallet(wallet, input.signedXdr);
  return checkKyc(input);
}

export async function submitKyc(formData: FormData): Promise<KycActionResult> {
  const viewer = await requireViewer("/");
  const limited = await limitAction("kyc", { limit: 8, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };
  const walletId = String(formData.get("walletId") ?? "");
  const kind = formData.get("kind") === "withdraw" ? "withdraw" : "deposit";
  const amountUsdc = Number(formData.get("amountUsdc") ?? 0);
  const wallet = await ownWallet(viewer.id, walletId);
  if (!wallet) return { ok: false, error: "Choose one of your wallets." };
  const auth = await ensureSep10(wallet);
  if ("step" in auth) {
    return { ok: true, step: "sep10", challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
  }
  const fields: Record<string, string | Blob> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "walletId" || key === "kind" || key === "amountUsdc") continue;
    if (typeof value === "string") {
      if (value.trim()) fields[key] = value;
      continue;
    }
    const file = value as File;
    if (file.size > 0) fields[key] = file;
  }
  try {
    return fromGate(
      await submitKycFields({
        userId: viewer.id,
        account: wallet.public_key,
        jwt: auth.jwt,
        fields,
        kind,
        amountUsdc,
      }),
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The anchor did not accept those details." };
  }
}
