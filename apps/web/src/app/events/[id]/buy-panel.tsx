"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { beginCheckout, completeCheckout, type CheckoutResult } from "./actions";
import { Button } from "@/components/ui/button";

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
  const selected = wallets.find((wallet) => wallet.id === walletId);

  const run = (method: "wallet" | "mobile_money") =>
    startTransition(async () => {
      setError(null);
      if (!selected) {
        setError("Sign in to choose a wallet.");
        return;
      }
      let step: CheckoutResult = await beginCheckout({ eventId, tierId, walletId: selected.id, method, idempotencyKey });
      while (step.ok && (step.step === "trustline" || step.step === "sign")) {
        try {
          const signedXdr = await signStellarTransaction(step.xdr, step.address);
          step = await completeCheckout({ orderId: step.orderId, signedXdr, step: step.step });
        } catch (err) {
          const message = walletUserMessage(err);
          setError(
            message ??
              (step.ok && step.step === "trustline"
                ? "The USDC trustline was not approved."
                : "The purchase was not signed."),
          );
          return;
        }
      }
      if (!step.ok) {
        setError(step.error);
        return;
      }
      setTicketId(step.chainTicketId);
      toast.success("Ticket purchased");
      router.refresh();
    });

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
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || soldOut} onClick={() => run("wallet")} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {soldOut ? "Sold out" : "Pay with this wallet"}
        </Button>
        <Button type="button" variant="outline" disabled={pending || soldOut} onClick={() => run("mobile_money")} className="h-10 px-4">
          Mobile money
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Mobile money is a test stub: no prompt is sent to your phone. The platform pays the test USDC and the ticket is
        delivered to the wallet you selected. Add a phone number on your account first.
      </p>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
