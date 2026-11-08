"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { beginCreateEvent, finishCreateEvent } from "./event-actions";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

export function EventForm({ wallets }: { wallets: WalletChoice[] }) {
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      form.set("walletId", walletId);
      try {
        let result = await beginCreateEvent(form);
        if (result.ok && result.step === "sign") {
          const signedXdr = await signStellarTransaction(result.xdr, result.address);
          result = await finishCreateEvent({ walletId, signedXdr, action: result.action });
        }
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.step === "done") toast.success(result.message);
        (document.getElementById("create-event-form") as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(walletUserMessage(err) ?? "The event was not signed.");
      }
    });

  if (wallets.length === 0) {
    return <p className="text-muted-foreground text-sm">Connect a Stellar wallet to create an event on-chain.</p>;
  }

  return (
    <form
      id="create-event-form"
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(new FormData(event.currentTarget));
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Organizer wallet</legend>
        {wallets.map((wallet) => (
          <label key={wallet.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="create-wallet" checked={walletId === wallet.id} onChange={() => setWalletId(wallet.id)} />
            <span>{wallet.kind === "freighter" ? "Stellar wallet" : "BY Tickets wallet"}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
            </span>
          </label>
        ))}
      </fieldset>
      <Field name="title" label="Event title" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="venue_name" label="Venue" required />
        <Field name="city" label="City" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="starts_at" label="Starts" type="datetime-local" required />
        <Field name="ends_at" label="Ends" type="datetime-local" hint="Used on-chain for complete_event. Leave empty to complete immediately." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="capacity" label="Capacity" type="number" min={1} defaultValue="100" required />
        <Field name="priceUsdc" label="Ticket price (USDC)" inputMode="decimal" defaultValue="10" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="max_transfers" label="Max transfers" type="number" min={0} max={100} defaultValue="1" />
        <Field name="resaleCapUsdc" label="Resale cap (USDC)" inputMode="decimal" defaultValue="15" hint="0 means gifts only." />
      </div>
      <Field
        name="royaltyPercent"
        label="Resale royalty (%)"
        type="number"
        min={0}
        max={15}
        step="0.1"
        defaultValue="0"
        hint="Share of each resale paid to your split wallets. Capped at 15%."
      />
      <Field name="payout_public_key" label="Payout address (optional)" placeholder="G…" hint="Defaults to your organizer payout wallet." className="font-mono text-xs" />
      <Button type="submit" disabled={pending} className="h-10 px-4">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Create event on-chain
      </Button>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
