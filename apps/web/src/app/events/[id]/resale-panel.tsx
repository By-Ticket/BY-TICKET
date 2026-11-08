"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signStellarTransaction, walletUserMessage } from "@/lib/stellar/wallets-kit";
import { beginBuyListing, finishBuyListing, pollBuyListing, quoteListing, type BuyListingResult } from "./resale-actions";

interface WalletChoice {
  id: string;
  kind: "custodial" | "freighter";
  publicKey: string;
}

type Quote = { listingId: string; price: string; fee: string; royalty: string; seller: string; cap: string };

export function ResalePanel({
  listings,
  wallets,
}: {
  listings: { id: string; priceUsdc: string; ticketLabel: string }[];
  wallets: WalletChoice[];
}) {
  const [walletId, setWalletId] = useState(wallets[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [waitingId, setWaitingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const apply = async (listingId: string, result: BuyListingResult) => {
    if (!result.ok) {
      setError(result.error);
      setWaitingId(null);
      return;
    }
    if (result.step === "wait_seller") {
      setWaitingId(listingId);
      setNote(result.message);
      return;
    }
    if (result.step === "sign") {
      setWaitingId(null);
      const signedXdr = await signStellarTransaction(result.xdr, result.address);
      return apply(listingId, await finishBuyListing({ listingId, walletId, signedXdr }));
    }
    if (result.step === "done") {
      setWaitingId(null);
      setQuote(null);
      setNote(null);
      toast.success(result.message);
    }
  };

  const preview = (listingId: string) =>
    startTransition(async () => {
      setError(null);
      setNote(null);
      const next = await quoteListing(listingId);
      if (!next) {
        setError("That listing is no longer available.");
        return;
      }
      setQuote({ listingId, ...next });
    });

  const confirm = () => {
    if (!quote) return;
    startTransition(async () => {
      setError(null);
      try {
        await apply(quote.listingId, await beginBuyListing({ listingId: quote.listingId, walletId }));
      } catch (err) {
        setError(walletUserMessage(err) ?? "The purchase was not signed.");
      }
    });
  };

  useEffect(() => {
    if (!waitingId) return;
    const timer = window.setInterval(() => {
      startTransition(async () => {
        try {
          await apply(waitingId, await pollBuyListing(waitingId));
        } catch (err) {
          setError(walletUserMessage(err) ?? "Could not refresh this sale.");
        }
      });
    }, 4_000);
    return () => window.clearInterval(timer);
    // Poll with the latest apply/wallet; recreating the interval on every render would reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingId, walletId]);

  if (listings.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="font-medium">Resale listings</p>
      <p className="text-muted-foreground text-xs">
        Review the fee and royalty split before you confirm. Those amounts are taken on-chain when you buy.
      </p>
      {wallets.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Pay from</legend>
          {wallets.map((wallet) => (
            <label key={wallet.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="resale-wallet" checked={walletId === wallet.id} onChange={() => setWalletId(wallet.id)} />
              <span className="text-muted-foreground font-mono text-xs">
                {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <ul className="space-y-2">
        {listings.map((listing) => (
          <li key={listing.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {listing.ticketLabel} · {listing.priceUsdc}
            </span>
            <Button type="button" variant="outline" disabled={pending || wallets.length === 0} onClick={() => preview(listing.id)} className="h-9 px-3">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Review
            </Button>
          </li>
        ))}
      </ul>
      {quote && (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <p className="font-medium">Confirm purchase</p>
          <p>
            Price {quote.price} · fee {quote.fee} · royalty {quote.royalty} · seller {quote.seller}
          </p>
          <p className="text-muted-foreground text-xs">Resale cap {quote.cap}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={confirm} className="h-9 px-3">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Confirm purchase
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setQuote(null)} className="h-9 px-3">
              Cancel
            </Button>
          </div>
        </div>
      )}
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
