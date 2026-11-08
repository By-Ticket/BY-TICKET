import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { contractsConfigured, stellarConfig } from "@/lib/stellar/config";
import { getRpc } from "@/lib/stellar/rpc";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

/** Liveness + configuration check. Reports which integrations are configured, never their values. */
export async function GET(request: Request) {
  const limit = rateLimit(`health:${clientIp(request.headers)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let rpcStatus: { url: string; reachable: boolean; latestLedger?: number } = {
    url: stellarConfig.rpcUrl,
    reachable: false,
  };
  try {
    const ledger = await Promise.race([
      getRpc().getLatestLedger(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4_000)),
    ]);
    rpcStatus = { ...rpcStatus, reachable: true, latestLedger: ledger.sequence };
  } catch {
    // Unreachable RPC is reported, not thrown: health must still answer offline.
  }

  // Read-only probe. Writes stay on the signed-in flows (profile, organizer application).
  let database: { reachable: boolean; settings?: number } = { reachable: false };
  if (supabaseAdminConfigured) {
    try {
      const admin = createSupabaseAdminClient();
      const { count, error } = await Promise.race([
        admin.from("platform_settings").select("key", { count: "exact", head: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4_000)),
      ]);
      database = error ? { reachable: false } : { reachable: true, settings: count ?? 0 };
    } catch {
      database = { reachable: false };
    }
  }

  return NextResponse.json({
    status: "ok",
    app: publicEnv.NEXT_PUBLIC_APP_NAME,
    network: stellarConfig.network,
    rpc: rpcStatus,
    database,
    configured: {
      supabase: supabaseConfigured && Boolean(serverEnv.SUPABASE_SECRET_KEY),
      contracts: contractsConfigured,
      platformAccount: Boolean(serverEnv.STELLAR_PLATFORM_SECRET),
      qrSigning: Boolean(serverEnv.QR_CREDENTIAL_SIGNING_KEY && publicEnv.NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY),
      custodialKeys: Boolean(serverEnv.CUSTODIAL_KEY_ENCRYPTION_KEY),
      paymentRamp: serverEnv.RAMP_PROVIDER,
      anchorHomeDomain: Boolean(serverEnv.ANCHOR_HOME_DOMAIN) || serverEnv.RAMP_PROVIDER === "sep24",
      kycCallback: Boolean(serverEnv.ANCHOR_CALLBACK_SECRET),
      kycThreshold: serverEnv.KYC_THRESHOLD_AMOUNT,
    },
  });
}
