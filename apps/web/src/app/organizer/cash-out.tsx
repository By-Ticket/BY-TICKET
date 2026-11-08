"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InteractiveRamp } from "@/components/payments/interactive-ramp";
import { KycForm } from "@/components/payments/kyc-form";
import type { KycField, KycStatus } from "@/lib/payments/kyc-status";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { finishSep10Kyc, type KycActionResult } from "@/app/kyc/actions";
import { beginCashOut, finishSep10CashOut, pollCashOut, submitCashOutPayment, type CashOutResult } from "./ramp-actions";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

export function CashOutPanel({
  wallets,
  kycStatus,
}: {
  wallets: WalletChoice[];
  kycStatus?: KycStatus | null;
}) {
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ramp, setRamp] = useState<{ rampId: string; url: string; status: string; message: string } | null>(null);
  const [kyc, setKyc] = useState<{ message: string; fields: KycField[]; pending?: boolean } | null>(null);
  const selected = wallets.find((wallet) => wallet.id === walletId);

  const apply = async (step: CashOutResult): Promise<boolean> => {
    if (!step.ok) {
      setError(step.error);
      return false;
    }
    if (step.step === "done") {
      setDone(step.message);
      setRamp(null);
      toast.success("Cash-out completed");
      return false;
    }
    if (step.step === "sep10") {
      const signedXdr = await signStellarTransaction(step.challengeXdr, step.address);
      return apply(await finishSep10CashOut({ walletId, signedXdr, amountUsdc: amount }));
    }
    if (step.step === "kyc") {
      setKyc({ message: step.message, fields: step.fields });
      return false;
    }
    if (step.step === "kyc_pending") {
      setKyc({ message: step.message, fields: [], pending: true });
      return false;
    }
    if (step.step === "pay") {
      const signedXdr = await signStellarTransaction(step.xdr, step.address);
      return apply(await submitCashOutPayment({ rampId: step.rampId, signedXdr, walletId }));
    }
    setRamp({ rampId: step.rampId, url: step.url, status: step.status, message: step.message });
    return false;
  };

  const run = () =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      if (!selected) {
        setError("Connect a Stellar wallet first.");
        return;
      }
      try {
        await apply(await beginCashOut({ walletId: selected.id, amountUsdc: amount }));
      } catch (err) {
        setError(walletUserMessage(err) ?? "Cash-out was not signed.");
      }
    });

  useEffect(() => {
    if (!ramp || !selected) return;
    const timer = window.setInterval(() => {
      startTransition(async () => {
        try {
          await apply(await pollCashOut({ rampId: ramp.rampId, walletId: selected.id }));
        } catch (err) {
          setError(walletUserMessage(err) ?? "Could not refresh cash-out.");
        }
      });
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [ramp?.rampId, selected?.id, amount, walletId]);

  if (wallets.length === 0) {
    return <p className="text-muted-foreground text-sm">Connect a Stellar wallet on your account to cash out.</p>;
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Payout wallet</legend>
        {wallets.map((wallet) => (
          <label key={wallet.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="cashout-wallet" value={wallet.id} checked={walletId === wallet.id} onChange={() => setWalletId(wallet.id)} />
            <span>{wallet.kind === "freighter" ? "Stellar wallet" : "BY Tickets wallet"}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="cashout-amount">Amount (USDC)</Label>
        <Input id="cashout-amount" inputMode="decimal" placeholder="10.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </div>
      <p className="text-muted-foreground text-sm">
        Identity verification:{" "}
        <span className="text-foreground font-medium">{(kycStatus ?? "not started").replace("_", " ")}</span>
        {kycStatus !== "accepted" ? " — cash-out needs an accepted check." : ""}
      </p>
      {kyc?.pending ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p className="text-muted-foreground text-sm">{kyc.message}</p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setKyc(null); run(); }} className="h-10 px-4">
            Check again
          </Button>
        </div>
      ) : kyc ? (
        <KycForm
          walletId={walletId}
          kind="withdraw"
          amountUsdc={Number(amount || 0)}
          message={kyc.message}
          fields={kyc.fields}
          onResult={async (result: KycActionResult) => {
            let next = result;
            if (next.ok && next.step === "sep10") {
              const signedXdr = await signStellarTransaction(next.challengeXdr, next.address);
              next = await finishSep10Kyc({ walletId, signedXdr, kind: "withdraw", amountUsdc: Number(amount || 0) });
            }
            if (!next.ok) {
              setError(next.error);
              return;
            }
            if (next.step === "ready") {
              setKyc(null);
              run();
              return;
            }
            if (next.step === "kyc_pending") setKyc({ message: next.message, fields: [], pending: true });
            if (next.step === "kyc") setKyc({ message: next.message, fields: next.fields });
          }}
        />
      ) : ramp ? (
        <InteractiveRamp url={ramp.url} status={ramp.status} message={ramp.message} onCancel={() => setRamp(null)} />
      ) : (
        <Button type="button" disabled={pending || !amount} onClick={run} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Cash out to local currency
        </Button>
      )}
      {done && <p className="text-sm">{done}</p>}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
