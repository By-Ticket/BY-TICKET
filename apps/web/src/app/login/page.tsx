import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectStellarWallet } from "@/components/wallet/connect-stellar";
import { getViewer } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/redirect";
import { supabaseConfigured } from "@/lib/supabase/client";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const LINK_ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new code below.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null, "/tickets");
  if (await getViewer()) redirect(next);
  const linkError = typeof params.error === "string" ? LINK_ERRORS[params.error] : undefined;

  return (
    <div className="mx-auto max-w-md px-4 py-8 md:py-16">
      <Card>
        <div className="bg-brand h-1.5" aria-hidden />
        <CardHeader>
          <Logo withTagline />
          <CardTitle className="mt-4 text-[28px] leading-8 font-bold">Sign in</CardTitle>
          <CardDescription>
            Use a Stellar wallet, or we email you a code. Tickets and BY Points stay in your account either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {supabaseConfigured ? (
            <>
              <ConnectStellarWallet mode="login" next={next} />
              <div className="text-muted-foreground flex items-center gap-3 text-xs uppercase">
                <span className="bg-border h-px flex-1" />
                or email
                <span className="bg-border h-px flex-1" />
              </div>
              <LoginForm next={next} initialError={linkError} />
            </>
          ) : (
            <p className="rounded-xl border border-border bg-muted p-3 text-sm" role="status">
              Sign-in isn&apos;t set up yet. Add the Supabase URL and keys to <code>apps/web/.env.local</code>, then
              restart the app.
            </p>
          )}
          <p className="text-muted-foreground flex gap-2 text-xs">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            Freighter, xBull, Albedo, LOBSTR, Rabet and other Stellar wallets work. You sign a one-time message; nothing
            is spent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
