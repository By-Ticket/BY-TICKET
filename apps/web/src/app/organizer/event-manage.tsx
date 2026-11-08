"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { fromUnits } from "@/lib/payments/pricing";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { CashOutPanel } from "./cash-out";
import { beginEventAction, finishEventAction, type ChainSignResult } from "./event-actions";
import type { KycStatus } from "@/lib/payments/kyc-status";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

export function EventManage({
  eventId,
  title,
  chainEventId,
  dbStatus,
  chainStatus,
  escrow,
  payoutReleased,
  wallets,
  kycStatus,
  lastPayoutId,
  lastPayoutUnits,
  ended,
}: {
  eventId: string;
  title: string;
  chainEventId: number;
  dbStatus: string;
  chainStatus: string;
  escrow: bigint;
  payoutReleased: boolean;
  wallets: WalletChoice[];
  kycStatus?: KycStatus | null;
  lastPayoutId?: string;
  lastPayoutUnits?: number;
  ended: boolean;
}) {
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cashOutAmount, setCashOutAmount] = useState(lastPayoutUnits ? fromUnits(BigInt(lastPayoutUnits), 7) : "");
  const [payoutId, setPayoutId] = useState(lastPayoutId);
  const canComplete = chainStatus === "Live" && ended;
  const canCancel = chainStatus === "Live" && !payoutReleased;
  const canRelease = chainStatus !== "Cancelled" && escrow > 0n;

  const run = (action: "complete" | "cancel" | "release" | "milestone", extra?: { minCheckins?: number; partialPercent?: number }) =>
    startTransition(async () => {
      setError(null);
      try {
        let result: ChainSignResult = await beginEventAction({ eventId, walletId, action, ...extra });
        if (result.ok && result.step === "sign") {
          const signedXdr = await signStellarTransaction(result.xdr, result.address);
          result = await finishEventAction({ walletId, signedXdr, action: result.action });
        }
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.step === "done") {
          toast.success(result.message);
          if (result.amountUsdc) {
            setCashOutAmount(result.amountUsdc);
            if (result.payoutId) setPayoutId(result.payoutId);
          }
        }
      } catch (err) {
        setError(walletUserMessage(err) ?? "The transaction was not signed.");
      }
    });

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">
          On-chain #{chainEventId} · {chainStatus} · escrow {fromUnits(escrow)} USDC · DB {dbStatus.replaceAll("_", " ")}
        </p>
      </div>
      {wallets.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Signing wallet</legend>
          {wallets.map((wallet) => (
            <label key={wallet.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`manage-${eventId}`} checked={walletId === wallet.id} onChange={() => setWalletId(wallet.id)} />
              <span className="text-muted-foreground font-mono text-xs">
                {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !canComplete} onClick={() => run("complete")} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Complete event
        </Button>
        <Button type="button" variant="outline" disabled={pending || !canRelease} onClick={() => run("release")} className="h-10 px-4">
          Release payout
        </Button>
        <Button type="button" variant="ghost" disabled={pending || !canCancel} onClick={() => run("cancel")} className="h-10 px-4">
          Cancel event
        </Button>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          run("milestone", {
            minCheckins: Number(data.get("minCheckins") ?? 0),
            partialPercent: Number(data.get("partialPercent") ?? 0),
          });
        }}
      >
        <Field name="minCheckins" label="Milestone check-ins" type="number" min={1} className="w-32" />
        <Field name="partialPercent" label="Partial payout %" type="number" min={1} max={100} className="w-32" />
        <Button type="submit" variant="outline" disabled={pending || chainStatus !== "Live"} className="h-10 px-4">
          Set milestone
        </Button>
      </form>
      {payoutReleased || cashOutAmount ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Cash out to local currency</p>
          <CashOutPanel key={payoutId ?? (cashOutAmount || "cashout")} wallets={wallets} kycStatus={kycStatus} defaultAmount={cashOutAmount} payoutId={payoutId} />
        </div>
      ) : null}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
