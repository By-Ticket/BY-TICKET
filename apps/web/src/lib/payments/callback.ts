import { createHmac, timingSafeEqual } from "node:crypto";

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Accept a Bearer shared secret, `x-callback-secret`, or `sha256=<hex>` HMAC of the raw body.
 */
export function verifyAnchorCallback(headers: Headers, rawBody: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer && equal(bearer, secret)) return true;
  const headerSecret = headers.get("x-callback-secret")?.trim();
  if (headerSecret && equal(headerSecret, secret)) return true;
  const signature = (headers.get("signature") ?? headers.get("x-payload-signature") ?? "").trim();
  const hex = signature.replace(/^sha256=/i, "");
  if (hex && equal(hex.toLowerCase(), hmacSha256Hex(secret, rawBody).toLowerCase())) return true;
  return false;
}
