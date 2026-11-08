import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Host from NEXT_PUBLIC_APP_URL (e.g. localhost:3000). */
export function configuredAppHost(): string {
  return new URL(publicEnv.NEXT_PUBLIC_APP_URL).host;
}

/**
 * Host to bind into wallet-sign-in messages. Prefers the public hostname in front
 * of this process (Cloudflare Tunnel) when it is one we recognise; otherwise the
 * configured app URL. Never trusts an arbitrary Host header.
 */
export function resolveAppHost(rawHost: string | null | undefined, configuredUrl: string): string {
  const configured = new URL(configuredUrl).host;
  const host = (rawHost ?? "").split(",")[0]?.trim() ?? "";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (/^[a-z0-9-]+\.trycloudflare\.com$/.test(hostname)) return hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return host || configured;
  if (hostname === configured.split(":")[0].toLowerCase()) return configured;
  return configured;
}

export async function requestAppHost(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-host") ?? h.get("host");
  return resolveAppHost(forwarded, publicEnv.NEXT_PUBLIC_APP_URL);
}
