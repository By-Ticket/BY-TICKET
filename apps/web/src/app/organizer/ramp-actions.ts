"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { custodialKeypair } from "@/lib/custodial/keys";
import { createRampAdapter, rampProvider } from "@/lib/payments/ramp";
import { completeSep10ForWallet, ensureAnchorOffers, ensureSep10, insertRampTx, loadRampTx, persistStatus, updateRampTx } from "@/lib/payments/ramp-flow";
import { isTerminalRampStatus, rampStatusMessage } from "@/lib/payments/status";
import { limitAction } from "@/lib/security/action-guard";
import { chainConfig } from "@/lib/stellar/app-chain";
import { buildPaymentXdr, sendPayment, submitSignedPayment } from "@/lib/stellar/chain";
import { stellarConfig } from "@/lib/stellar/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type CashOutResult =
  | { ok: true; step: "sep10"; rampId?: string; challengeXdr: string; address: string; homeDomain: string }
  | { ok: true; step: "ramp"; rampId: string; url: string; status: string; message: string }
  | { ok: true; step: "pay"; rampId: string; xdr: string; address: string; message: string }
  | { ok: true; step: "done"; rampId: string; message: string }
  | { ok: false; error: string };

const beginSchema = z.object({
  walletId: z.uuid(),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,7})?$/),
});

async function loadOwnWallet(userId: string, walletId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("wallets").select("id, user_id, kind, public_key").eq("id", walletId).maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data;
}

export async function beginCashOut(input: z.infer<typeof beginSchema>): Promise<CashOutResult> {
  const viewer = await requireRole("organizer", "/organizer");
  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid USDC amount." };
  const limited = await limitAction("cashout", { limit: 6, windowMs: 15 * 60_000, subject: viewer.id });
  if (limited) return { ok: false, error: limited };

  try {
    if (rampProvider() === "sep24") {
      const missing = await ensureAnchorOffers("withdraw");
      if (missing) return { ok: false, error: missing };
    }

    const wallet = await loadOwnWallet(viewer.id, parsed.data.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };

    const auth = await ensureSep10(wallet);
    if ("step" in auth) {
      return { ok: true, step: "sep10", challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
    }

    const adapter = await createRampAdapter(rampProvider(), auth.jwt);
    const session = await adapter.startOffRamp({
      reference: crypto.randomUUID(),
      amountUsdcUnits: 0n,
      amountUsdc: parsed.data.amountUsdc,
      assetCode: stellarConfig.usdc.code,
      sourceAccount: wallet.public_key,
      phone: "",
    });
    const row = await insertRampTx({
      user_id: viewer.id,
      kind: "withdraw",
      amount: Number(parsed.data.amountUsdc),
      asset_code: stellarConfig.usdc.code,
      asset_issuer: stellarConfig.usdc.issuer,
      anchor_tx_id: session.providerReference,
      status: persistStatus(session.status),
      provider: adapter.provider,
      interactive_url: session.interactiveUrl,
    });
    if (adapter.provider === "stub") {
      return { ok: true, step: "done", rampId: row.id, message: "Stub: payout auto-sent." };
    }
    return {
      ok: true,
      step: "ramp",
      rampId: row.id,
      url: session.interactiveUrl ?? "",
      status: session.status,
      message: rampStatusMessage(session.status),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Cash-out failed." };
  }
}

export async function finishSep10CashOut(input: {
  walletId: string;
  signedXdr: string;
  amountUsdc: string;
}): Promise<CashOutResult> {
  const viewer = await requireRole("organizer", "/organizer");
  try {
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    await completeSep10ForWallet(wallet, input.signedXdr);
    return beginCashOut({ walletId: input.walletId, amountUsdc: input.amountUsdc });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not sign in at the anchor." };
  }
}

export async function pollCashOut(input: { rampId: string; walletId: string }): Promise<CashOutResult> {
  const viewer = await requireRole("organizer", "/organizer");
  try {
    const row = await loadRampTx(input.rampId, viewer.id);
    if (!row?.anchor_tx_id) return { ok: false, error: "That transfer was not found." };
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    const auth = await ensureSep10(wallet);
    if ("step" in auth) {
      return { ok: true, step: "sep10", rampId: row.id, challengeXdr: auth.challengeXdr, address: auth.address, homeDomain: auth.homeDomain };
    }
    const adapter = await createRampAdapter(rampProvider(), auth.jwt);
    const session = await adapter.getStatus(row.anchor_tx_id);
    await updateRampTx(row.id, viewer.id, {
      status: persistStatus(session.status),
      withdraw_account: session.withdrawAccount,
      memo: session.withdrawMemo,
    });
    if (session.status === "settled") {
      return { ok: true, step: "done", rampId: row.id, message: rampStatusMessage(session.status) };
    }
    if (isTerminalRampStatus(session.status)) {
      return { ok: false, error: rampStatusMessage(session.status) };
    }
    if (session.withdrawAccount && session.amountIn) {
      const pay = {
        destination: session.withdrawAccount,
        amount: session.amountIn,
        memo: session.withdrawMemo,
        memoType: session.withdrawMemoType,
      };
      if (wallet.kind === "custodial") {
        const keypair = await custodialKeypair(wallet.id, wallet.public_key);
        await sendPayment(chainConfig(), keypair, pay);
        return {
          ok: true,
          step: "ramp",
          rampId: row.id,
          url: row.interactive_url ?? "",
          status: "pending",
          message: "Payment sent to the anchor. Waiting for it to complete.",
        };
      }
      return {
        ok: true,
        step: "pay",
        rampId: row.id,
        address: wallet.public_key,
        message: "Send USDC to the anchor to finish cash-out.",
        xdr: await buildPaymentXdr(chainConfig(), wallet.public_key, pay),
      };
    }
    return {
      ok: true,
      step: "ramp",
      rampId: row.id,
      url: row.interactive_url ?? session.interactiveUrl ?? "",
      status: session.status,
      message: rampStatusMessage(session.status),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not refresh cash-out status." };
  }
}

export async function submitCashOutPayment(input: {
  rampId: string;
  signedXdr: string;
  walletId: string;
}): Promise<CashOutResult> {
  const viewer = await requireRole("organizer", "/organizer");
  try {
    const row = await loadRampTx(input.rampId, viewer.id);
    if (!row) return { ok: false, error: "That transfer was not found." };
    const wallet = await loadOwnWallet(viewer.id, input.walletId);
    if (!wallet) return { ok: false, error: "Choose one of your wallets." };
    await submitSignedPayment(chainConfig(), input.signedXdr, wallet.public_key);
    return pollCashOut({ rampId: input.rampId, walletId: input.walletId });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The payout payment failed." };
  }
}
