import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this module from a Client Component fails the
 * build (`server-only`), so secrets can't leak into browser bundles.
 * See docs/SECURITY.md for how each secret is generated, stored and rotated.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: optional(z.string().min(20)),
  STELLAR_PLATFORM_SECRET: optional(z.string().regex(/^S[A-Z2-7]{55}$/, "must be a Stellar secret seed (S...)")),
  CUSTODIAL_KEY_ENCRYPTION_KEY: optional(
    z.base64().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  ),
  QR_CREDENTIAL_SIGNING_KEY: optional(
    z.base64url().refine((v) => Buffer.from(v, "base64url").length === 32, "must be a 32-byte Ed25519 seed"),
  ),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(2_000).default(250),
  RAMP_PROVIDER: z.enum(["stub", "sep24", "mtn_momo", "airtel_money", "zamtel_kwacha"]).default("stub"),
  ANCHOR_HOME_DOMAIN: optional(z.string().min(3).max(253)),
  /** @deprecated Use RAMP_PROVIDER. Kept so existing .env.local files still work. */
  PAYMENT_RAMP_PROVIDER: optional(z.enum(["stub", "sep24", "mtn_momo", "airtel_money", "zamtel_kwacha"])),
  UPSTASH_REDIS_REST_URL: optional(z.url()),
  UPSTASH_REDIS_REST_TOKEN: optional(z.string()),
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type ServerEnv = z.infer<typeof serverSchema>;

const result = serverSchema.safeParse({
  ...process.env,
  RAMP_PROVIDER: process.env.RAMP_PROVIDER || process.env.PAYMENT_RAMP_PROVIDER || "stub",
});
if (!result.success) {
  throw new Error(`Invalid server environment:\n${z.prettifyError(result.error)}`);
}

export const serverEnv: ServerEnv = result.data;
