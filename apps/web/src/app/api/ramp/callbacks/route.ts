import { NextResponse } from "next/server";
import { verifyAnchorCallback } from "@/lib/payments/callback";
import { fieldsFromCustomer, type Sep12FieldSpec } from "@/lib/payments/sep12";
import { mapSep12Status } from "@/lib/payments/kyc-status";
import { parseSep24Webhook } from "@/lib/payments/sep24";
import { persistStatus } from "@/lib/payments/ramp-flow";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { serverEnv } from "@/lib/env.server";

const SEP12 = new Set(["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"]);

/**
 * Anchor Platform + SEP-12 customer callbacks. Auth is a shared secret or HMAC of the body.
 * Never persists identity documents — only status and required field names.
 */
export async function POST(request: Request) {
  const limited = rateLimit(`anchor-callback:${clientIp(request.headers)}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: { code: "rate_limited" } }, { status: 429 });
  }
  const raw = await request.text();
  if (!verifyAnchorCallback(request.headers, raw, serverEnv.ANCHOR_CALLBACK_SECRET)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Invalid callback signature." } }, { status: 401 });
  }
  if (!supabaseAdminConfigured) {
    return NextResponse.json({ error: { code: "unavailable" } }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const customerId = typeof body.id === "string" ? body.id : undefined;
  const customerStatus = typeof body.status === "string" ? body.status : undefined;
  const looksLikeCustomer = Boolean(customerStatus && SEP12.has(customerStatus.toUpperCase()));
  if (looksLikeCustomer && (customerId || typeof body.account === "string")) {
    const patch: {
      status: ReturnType<typeof mapSep12Status>;
      message: string | null;
      fields_needed?: Json;
    } = {
      status: mapSep12Status(customerStatus!),
      message: typeof body.message === "string" ? body.message : null,
    };
    if (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)) {
      patch.fields_needed = JSON.parse(
        JSON.stringify(
          fieldsFromCustomer({
            status: "NEEDS_INFO",
            fields: body.fields as Record<string, Sep12FieldSpec>,
          }),
        ),
      ) as Json;
    }
    let query = admin.from("kyc_customers").update(patch);
    query = customerId ? query.eq("anchor_customer_id", customerId) : query.eq("account", String(body.account));
    await query;
  }

  if (!looksLikeCustomer) {
    try {
      const session = parseSep24Webhook(raw);
      await admin
        .from("ramp_transactions")
        .update({ status: persistStatus(session.status) })
        .eq("anchor_tx_id", session.providerReference);
    } catch {
      // Customer-only payloads (or malformed tx bodies) are ignored here; polling still updates status.
    }
  }

  return NextResponse.json({ ok: true });
}
