import "server-only";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import { fetchStellarToml } from "./toml";
import { defaultAnchorHomeDomain, rampProvider } from "./ramp";
import { Sep12Client, customerToRecord } from "./sep12";
import { evaluateKycGate, kycStatusMessage, parseStoredKycFields, type KycGate, type KycStatus } from "./kyc-status";

type KycRow = Database["public"]["Tables"]["kyc_customers"]["Row"];

function threshold(): number {
  return serverEnv.KYC_THRESHOLD_AMOUNT;
}

export async function upsertKyc(row: Database["public"]["Tables"]["kyc_customers"]["Insert"]): Promise<KycRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("kyc_customers")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function loadKyc(userId: string): Promise<KycRow | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("kyc_customers").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

async function persistFromAnchor(
  userId: string,
  account: string,
  customer: ReturnType<typeof customerToRecord>,
): Promise<KycRow> {
  return upsertKyc({
    user_id: userId,
    account,
    status: customer.status,
    anchor_customer_id: customer.id ?? null,
    fields_needed: JSON.parse(JSON.stringify(customer.fields)) as Json,
    message: customer.message ?? null,
    home_domain: defaultAnchorHomeDomain() || null,
    provider: rampProvider(),
  });
}

export async function refreshKyc(input: {
  userId: string;
  account: string;
  jwt: string;
  kind: "deposit" | "withdraw";
  amountUsdc: number;
}): Promise<KycGate> {
  if (rampProvider() === "stub") {
    await upsertKyc({
      user_id: input.userId,
      account: input.account,
      status: "accepted",
      fields_needed: [],
      message: "Stub: KYC auto-approved",
      provider: "stub",
    });
    return { action: "allow", status: "accepted" };
  }

  const toml = await fetchStellarToml(defaultAnchorHomeDomain());
  const client = new Sep12Client(toml, input.jwt);
  const raw = await client.getCustomer(input.account);
  const mapped = customerToRecord(raw);
  await persistFromAnchor(input.userId, input.account, mapped);
  try {
    const callbackUrl = new URL("/api/ramp/callbacks", publicEnv.NEXT_PUBLIC_APP_URL).toString();
    await client.registerCallback(callbackUrl, { id: raw.id, account: input.account });
  } catch {
    // Callbacks are optional; polling still works.
  }
  return evaluateKycGate({
    kind: input.kind,
    status: mapped.status,
    fields: mapped.fields,
    amountUsdc: input.amountUsdc,
    thresholdUsdc: threshold(),
    message: mapped.message,
  });
}

export async function submitKycFields(input: {
  userId: string;
  account: string;
  jwt: string;
  fields: Record<string, string | Blob>;
  kind: "deposit" | "withdraw";
  amountUsdc: number;
}): Promise<KycGate> {
  if (rampProvider() === "stub") return refreshKyc(input);
  const toml = await fetchStellarToml(defaultAnchorHomeDomain());
  const client = new Sep12Client(toml, input.jwt);
  await client.putCustomer(input.fields, { account: input.account, type: "sep24" });
  return refreshKyc(input);
}

export function storedKycToGate(row: KycRow | null, kind: "deposit" | "withdraw", amountUsdc: number): KycGate | null {
  if (!row) return null;
  const fields = parseStoredKycFields(row.fields_needed);
  return evaluateKycGate({
    kind,
    status: row.status as KycStatus,
    fields,
    amountUsdc,
    thresholdUsdc: threshold(),
    message: row.message ?? kycStatusMessage(row.status as KycStatus),
  });
}
