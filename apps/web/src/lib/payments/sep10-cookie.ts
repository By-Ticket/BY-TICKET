import "server-only";
import { cookies } from "next/headers";

const COOKIE = "by_sep10";

export interface Sep10Session {
  token: string;
  account: string;
  homeDomain: string;
  expiresAt: string;
}

export async function readSep10Session(): Promise<Sep10Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Sep10Session;
    if (!parsed.token || !parsed.account || !parsed.homeDomain) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now() + 30_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSep10Session(session: Sep10Session): Promise<void> {
  const maxAge = Math.max(60, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  (await cookies()).set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSep10Session(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
