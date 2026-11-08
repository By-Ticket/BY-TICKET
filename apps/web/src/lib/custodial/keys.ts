import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { serverEnv } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { fromPgBytea, openSecret } from "./crypto";

/** Decrypt the platform-held secret for one custodial wallet. Never log the result. */
export async function custodialKeypair(walletId: string, publicKey: string): Promise<Keypair> {
  const encryptionKey = serverEnv.CUSTODIAL_KEY_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("CUSTODIAL_KEY_ENCRYPTION_KEY is not set");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("custodial_keys")
    .select("ciphertext, iv, auth_tag")
    .eq("wallet_id", walletId)
    .single();
  if (error) throw error;
  const secret = openSecret(
    {
      ciphertext: fromPgBytea(data.ciphertext),
      iv: fromPgBytea(data.iv),
      authTag: fromPgBytea(data.auth_tag),
    },
    publicKey,
    encryptionKey,
  );
  const keypair = Keypair.fromSecret(secret);
  if (keypair.publicKey() !== publicKey) throw new Error("Custodial key does not match the wallet");
  return keypair;
}
