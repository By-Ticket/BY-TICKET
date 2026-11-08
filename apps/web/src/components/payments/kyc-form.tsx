"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import type { KycField } from "@/lib/payments/kyc-status";
import { submitKyc, type KycActionResult } from "@/app/kyc/actions";

export function KycForm({
  walletId,
  kind,
  amountUsdc,
  message,
  fields,
  onResult,
}: {
  walletId: string;
  kind: "deposit" | "withdraw";
  amountUsdc: number;
  message: string;
  fields: KycField[];
  onResult: (result: KycActionResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const send = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      form.set("walletId", walletId);
      form.set("kind", kind);
      form.set("amountUsdc", String(amountUsdc));
      const result = await submitKyc(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onResult(result);
    });

  return (
    <form
      className="space-y-3 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        send(new FormData(event.currentTarget));
      }}
    >
      <p className="text-sm">{message}</p>
      {fields.map((field) =>
        field.type === "binary" ? (
          <Field
            key={field.name}
            name={field.name}
            label={field.description}
            type="file"
            required={!field.optional}
            hint="Sent only to the anchor. BY Tickets does not keep a copy."
          />
        ) : field.choices?.length ? (
          <div key={field.name} className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={field.name}>
              {field.description}
            </label>
            <select
              id={field.name}
              name={field.name}
              required={!field.optional}
              className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm"
            >
              <option value="">Select</option>
              {field.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <Field
            key={field.name}
            name={field.name}
            label={field.description}
            type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
            required={!field.optional}
          />
        ),
      )}
      <Button type="submit" disabled={pending} className="h-10 px-4">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Submit details
      </Button>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
