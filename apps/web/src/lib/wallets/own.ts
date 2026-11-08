import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function loadOwnWallet(userId: string, walletId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("wallets").select("id, user_id, kind, public_key").eq("id", walletId).maybeSingle();
  if (!data || data.user_id !== userId) return null;
  return data;
}
