import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
        <CardHeader>
          <CardTitle className="text-[28px] leading-8 font-semibold">Sign in</CardTitle>
          <CardDescription>
            No password and no crypto wallet needed. We email you a code, and your tickets and BY Points are kept safe
            in your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {supabaseConfigured ? (
            <LoginForm next={next} initialError={linkError} />
          ) : (
            <p className="rounded-xl border border-border bg-muted p-3 text-sm" role="status">
              Sign-in isn&apos;t set up yet. Add the Supabase URL and keys to <code>apps/web/.env.local</code>, then
              restart the app.
            </p>
          )}
          <p className="text-muted-foreground flex gap-2 text-xs">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            Have a Stellar wallet? You can connect Freighter from your account after signing in.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
