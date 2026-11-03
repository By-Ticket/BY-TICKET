"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { afterSignIn } from "@/lib/auth/bootstrap";
import { isLocalSupabaseUrl, safeNextPath } from "@/lib/auth/redirect";
import { limitAction } from "@/lib/security/action-guard";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createSupabaseAdminClient, createSupabaseServerClient, supabaseAdminConfigured } from "@/lib/supabase/server";
import { emailSchema, otpSchema } from "@/lib/validation/account";

export interface LoginState {
  step: "email" | "code";
  email?: string;
  error?: string;
  message?: string;
}

const sendSchema = z.object({ email: emailSchema });
const verifySchema = z.object({ email: emailSchema, token: otpSchema });

const NOT_CONFIGURED = "Sign-in isn't set up yet: add the Supabase keys to apps/web/.env.local.";

export async function authenticate(prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!supabaseConfigured) return { step: "email", error: NOT_CONFIGURED };
  const intent = formData.get("intent");
  const next = safeNextPath(formData.get("next")?.toString(), "/tickets");

  if (intent === "restart") return { step: "email" };

  if (intent === "send") {
    const parsed = sendSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) return { step: "email", error: parsed.error.issues[0]?.message };
    const { email } = parsed.data;

    const limited = await limitAction("otp-send", { limit: 5, windowMs: 15 * 60_000, subject: email });
    if (limited) return { step: "email", email, error: limited };

    const callback = new URL("/auth/callback", publicEnv.NEXT_PUBLIC_APP_URL);
    callback.searchParams.set("next", next);
    // The experimental local stack cannot serve a custom mail template, so Mailpit
    // only gets a PKCE link. Ask Auth for the one-time code and show it here.
    if (isLocalSupabaseUrl(publicEnv.NEXT_PUBLIC_SUPABASE_URL) && supabaseAdminConfigured) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: callback.toString() },
      });
      const code = data?.properties?.email_otp;
      if (error || !code) {
        console.error("local sign-in code failed", { status: error?.status, code: error?.code });
        return { step: "email", email, error: "We couldn't create a sign-in code. Check that the local Supabase stack is running." };
      }
      return {
        step: "code",
        email,
        message: `Your local sign-in code is ${code}. Enter it below. It is not emailed, because this local stack cannot put the code in Mailpit.`,
      };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: callback.toString() },
    });
    if (error) {
      console.error("signInWithOtp failed", { status: error.status, code: error.code });
      const message =
        error.status === 429
          ? "Too many emails sent. Wait a minute and try again."
          : "We couldn't send the email. Check the address and try again.";
      return { step: "email", email, error: message };
    }
    return {
      step: "code",
      email,
      message: `We sent a sign-in code to ${email}. Enter it below, or tap the link in the email.`,
    };
  }

  if (intent === "verify") {
    const parsed = verifySchema.safeParse({ email: formData.get("email"), token: formData.get("token") });
    if (!parsed.success) {
      return { step: "code", email: prev.email, error: parsed.error.issues[0]?.message };
    }
    const { email, token } = parsed.data;

    const limited = await limitAction("otp-verify", { limit: 8, windowMs: 15 * 60_000, subject: email });
    if (limited) return { step: "code", email, error: limited };

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error || !data.user) {
      return { step: "code", email, error: "That code is wrong or has expired. Check the latest email or send a new code." };
    }
    await afterSignIn(data.user);
    redirect(next);
  }

  return { step: "email", error: "Something went wrong. Please try again." };
}

export async function signOut() {
  if (supabaseConfigured) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
