"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  beginCheckout,
  completeCheckout,
  finishSep10Checkout,
  pollLocalCurrencyCheckout,
  type CheckoutResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { InteractiveRamp } from "@/components/payments/interactive-ramp";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

export function BuyPanel({
  eventId,
  tierId,
  wallets,
  soldOut,
}: {
  eventId: string;
  tierId: string;
  wallets: WalletChoice[];
  soldOut: boolean;
}) {
  const router = useRouter();
  const [walletId, setWalletId] = useState(wallets.find((wallet) => wallet.kind === "freighter")?.id ?? wallets[0]?.id ?? "");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ramp, setRamp] = useState<{ orderId: string; rampId: string; url: string; status: string; message: string } | null>(null);
  const selected = wallets.find((wallet) => wallet.id === walletId);

  const finish = (step: CheckoutResult) => {
    if (!step.ok) {
      setError(step.error);
      setRamp(null);
      return false;
    }
    if (step.step === "done") {
      setTicketId(step.chainTicketId);
      setRamp(null);
      toast.success("Ticket purchased");
      router.refresh();
      return false;
    }
    if (step.step === "ramp") {
      setRamp((current) => ({
        orderId: step.orderId,
        rampId: step.rampId,
        url: current?.url || step.url,
        status: step.status,
        message: step.message,
      }));
      return false;
    }
    return true;
  };

  const signThrough = async (step: CheckoutResult): Promise<CheckoutResult> => {
    let current = step;
    while (current.ok && (current.step === "trustline" || current.step === "sign")) {
      const signedXdr = await signStellarTransaction(current.xdr, current.address);
      current = await completeCheckout({ orderId: current.orderId, signedXdr, step: current.step });
    }
    if (current.ok && current.step === "sep10") {
      const signedXdr = await signStellarTransaction(current.challengeXdr, current.address);
      current = await finishSep10Checkout({ orderId: current.orderId, walletId: selected!.id, signedXdr });
    }
    return current;
  };

  const run = (method: "wallet" | "mobile_money" | "local_currency") =>
    startTransition(async () => {
      setError(null);
      if (!selected) {
        setError("Sign in to choose a wallet.");
        return;
      }
      try {
        let step: CheckoutResult = await beginCheckout({ eventId, tierId, walletId: selected.id, method, idempotencyKey });
        step = await signThrough(step);
        finish(step);
      } catch (err) {
        const message = walletUserMessage(err);
        setError(message ?? "The purchase was not signed.");
      }
    });

  useEffect(() => {
    if (!ramp || !selected) return;
    const timer = window.setInterval(() => {
      startTransition(async () => {
        try {
          let step: CheckoutResult = await pollLocalCurrencyCheckout({ rampId: ramp.rampId, walletId: selected.id });
          step = await signThrough(step);
          finish(step);
        } catch (err) {
          setError(walletUserMessage(err) ?? "Could not refresh the transfer.");
        }
      });
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [ramp?.rampId, selected?.id]);

  if (ticketId) {
    return (
      <div className="bg-emerald/10 rounded-xl border p-4">
        <p className="font-medium">You&apos;re in. Ticket #{ticketId} is in your wallet.</p>
        <Link href="/tickets" className="mt-2 inline-block text-sm underline">
          View my tickets
        </Link>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <Link href={`/login?next=/events/${eventId}`} className="text-sm underline">
        Sign in to buy a ticket
      </Link>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ticket goes to</legend>
        {wallets.map((wallet) => (
          <label key={wallet.id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="wallet"
              value={wallet.id}
              checked={walletId === wallet.id}
              onChange={() => setWalletId(wallet.id)}
            />
            <span>{wallet.kind === "freighter" ? "Stellar wallet" : "BY Tickets wallet"}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
            </span>
          </label>
        ))}
      </fieldset>
      {ramp ? (
        <InteractiveRamp url={ramp.url} status={ramp.status} message={ramp.message} onCancel={() => setRamp(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending || soldOut} onClick={() => run("wallet")} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {soldOut ? "Sold out" : "Pay with this wallet"}
          </Button>
          <Button type="button" variant="outline" disabled={pending || soldOut} onClick={() => run("local_currency")} className="h-10 px-4">
            Pay with local currency
          </Button>
          <Button type="button" variant="ghost" disabled={pending || soldOut} onClick={() => run("mobile_money")} className="h-10 px-4">
            Mobile money
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Local currency opens a Stellar anchor (SEP-24) so you can pay in fiat. The ticket is minted after the
        deposit completes. Mobile money is still a test stub. Add a phone number on your account for that path.
      </p>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
