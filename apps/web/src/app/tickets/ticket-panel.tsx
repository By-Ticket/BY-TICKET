"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { KycForm } from "@/components/payments/kyc-form";
import type { KycField } from "@/lib/payments/kyc-status";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { finishSep10Kyc, type KycActionResult } from "@/app/kyc/actions";
import {
  beginApproveSale,
  beginClaimRefund,
  beginListTicket,
  cancelListing,
  finishApproveSale,
  finishClaimRefund,
  finishSep10List,
  type TicketActionResult,
} from "./actions";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

export function TicketPanel({
  ticketId,
  chainTicketId,
  title,
  city,
  status,
  eventStatus,
  listingStatus,
  listingId,
  reserved,
  wallets,
}: {
  ticketId: string;
  chainTicketId: number;
  title: string;
  city?: string | null;
  status: string;
  eventStatus: string;
  listingStatus?: string | null;
  listingId?: string | null;
  reserved?: boolean;
  wallets: WalletChoice[];
}) {
  const [walletId, setWalletId] = useState(wallets.find((wallet) => wallet.kind === "freighter")?.id ?? wallets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kyc, setKyc] = useState<{ message: string; fields: KycField[]; pending?: boolean } | null>(null);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const [listDraft, setListDraft] = useState<{ priceUsdc: string; fiatPayout: "true" | "false" } | null>(null);
  const selected = wallets.find((wallet) => wallet.id === walletId);

  const apply = async (result: TicketActionResult) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.step === "sep10" && listDraft) {
      const signedXdr = await signStellarTransaction(result.challengeXdr, result.address);
      return apply(await finishSep10List({ ticketId, walletId, signedXdr, priceUsdc: listDraft.priceUsdc, fiatPayout: listDraft.fiatPayout }));
    }
    if (result.step === "sign") {
      const signedXdr = await signStellarTransaction(result.xdr, result.address);
      if (result.action.startsWith("refund:")) {
        return apply(await finishClaimRefund({ ticketId, walletId, signedXdr }));
      }
      if (result.action.startsWith("approve:")) {
        return apply(await finishApproveSale({ listingId: listingId!, walletId, signedXdr }));
      }
    }
    if (result.step === "kyc") {
      setKyc({ message: result.message, fields: result.fields });
      return;
    }
    if (result.step === "kyc_pending") {
      setKyc({ message: result.message, fields: [], pending: true });
      return;
    }
    if (result.step === "done") {
      toast.success(result.message);
      if (result.breakdown) {
        setBreakdown(`Fee ${result.breakdown.fee} · royalty ${result.breakdown.royalty} · you receive ${result.breakdown.seller} USDC`);
      }
    }
  };

  const run = (fn: () => Promise<TicketActionResult>) =>
    startTransition(async () => {
      setError(null);
      try {
        await apply(await fn());
      } catch (err) {
        setError(walletUserMessage(err) ?? "The transaction was not signed.");
      }
    });

  return (
    <li className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">
          {city} · ticket #{chainTicketId} · {status.replaceAll("_", " ")} · {eventStatus.replaceAll("_", " ")}
        </p>
      </div>
      {wallets.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Wallet</legend>
          {wallets.map((wallet) => (
            <label key={wallet.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={`ticket-wallet-${ticketId}`} checked={walletId === wallet.id} onChange={() => setWalletId(wallet.id)} />
              <span className="text-muted-foreground font-mono text-xs">
                {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {eventStatus === "cancelled" && status === "valid" && (
        <Button type="button" disabled={pending || !selected} onClick={() => run(() => beginClaimRefund({ ticketId, walletId }))} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Claim refund
        </Button>
      )}
      {eventStatus === "published" && status === "valid" && listingStatus !== "listed" && listingStatus !== "reserved" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const priceUsdc = String(data.get("priceUsdc") ?? "");
            const fiatPayout = data.get("fiatPayout") ? "true" : "false";
            setListDraft({ priceUsdc, fiatPayout });
            run(() =>
              beginListTicket({
                ticketId,
                walletId,
                priceUsdc,
                fiatPayout,
              }),
            );
          }}
        >
          <p className="text-sm font-medium">List for resale</p>
          <Field name="priceUsdc" label="Price (USDC)" inputMode="decimal" required hint="Must be at or below the event resale cap. Platform fee and royalty are taken on-chain." />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="fiatPayout" />
            I want to cash out proceeds in local currency (KYC required)
          </label>
          <Button type="submit" variant="outline" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            List ticket
          </Button>
        </form>
      )}
      {kyc?.pending ? (
        <p className="text-muted-foreground text-sm">{kyc.message}</p>
      ) : kyc ? (
        <KycForm
          walletId={walletId}
          kind="withdraw"
          amountUsdc={0}
          message={kyc.message}
          fields={kyc.fields}
          onResult={async (result: KycActionResult) => {
            let next = result;
            if (next.ok && next.step === "sep10") {
              const signedXdr = await signStellarTransaction(next.challengeXdr, next.address);
              next = await finishSep10Kyc({ walletId, signedXdr, kind: "withdraw", amountUsdc: 0 });
            }
            if (!next.ok) {
              setError(next.error);
              return;
            }
            if (next.step === "ready") {
              setKyc(null);
              toast.success("Identity verified. List the ticket again.");
            }
          }}
        />
      ) : null}
      {listingId && (listingStatus === "listed" || listingStatus === "reserved") && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => cancelListing(listingId))} className="h-10 px-4">
            Cancel listing
          </Button>
          {reserved && (
            <Button type="button" disabled={pending} onClick={() => run(() => beginApproveSale({ listingId, walletId }))} className="h-10 px-4">
              Approve sale
            </Button>
          )}
        </div>
      )}
      {breakdown && <p className="text-muted-foreground text-sm">{breakdown}</p>}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
