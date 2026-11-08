"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authenticate, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(authenticate, {
    step: "email",
    error: initialError,
  });

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.step === "email" ? (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            defaultValue={state.email}
            required
            autoFocus
            aria-invalid={Boolean(state.error) || undefined}
            aria-describedby={state.error ? "login-error" : undefined}
            className="h-11 text-base"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <Label htmlFor="token">Sign-in code</Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="123456"
            required
            autoFocus
            aria-invalid={Boolean(state.error) || undefined}
            aria-describedby={state.error ? "login-error" : "login-message"}
            className="h-12 rounded-xl text-center font-mono text-[28px] tracking-[0.4em]"
          />
        </div>
      )}

      {state.message && !state.error && (
        <p id="login-message" className="text-muted-foreground text-sm" role="status">
          {state.message}
        </p>
      )}
      {state.error && (
        <p id="login-error" className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        name="intent"
        value={state.step === "email" ? "send" : "verify"}
        disabled={pending}
        className="h-12 w-full rounded-xl text-[15px] font-semibold"
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          state.step === "email" && <Mail aria-hidden />
        )}
        {state.step === "email" ? "Email me a sign-in code" : "Sign in"}
      </Button>

      {state.step === "code" && (
        <div className="flex justify-between text-sm">
          <Button type="submit" name="intent" value="restart" variant="link" className="px-0" disabled={pending}>
            Use a different email
          </Button>
          <Button type="submit" name="intent" value="send" variant="link" className="px-0" disabled={pending}>
            Send a new code
          </Button>
        </div>
      )}
    </form>
  );
}
