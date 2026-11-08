"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { createWalletChallenge, verifyWalletChallenge } from "@/app/account/wallet-actions";
import { completeWalletLogin, createLoginChallenge } from "@/app/login/wallet-actions";
import { Button } from "@/components/ui/button";
import { pickStellarAddress, signStellarMessage, walletUserMessage } from "@/lib/stellar/wallets-kit";

export function ConnectStellarWallet({
  mode,
  next,
}: {
  mode: "login" | "link";
  next?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const connect = () =>
    startTransition(async () => {
      setError(null);
      try {
        const address = await pickStellarAddress();
        const challenge =
          mode === "login" ? await createLoginChallenge(address) : await createWalletChallenge(address);
        if (!challenge.ok) {
          setError(challenge.error);
          return;
        }
        const signature = await signStellarMessage(challenge.message, address);
        if (mode === "login") {
          const result = await completeWalletLogin({
            challengeId: challenge.challengeId,
            signature,
            next,
          });
          if (result && !result.ok) setError(result.error);
          return;
        }
        const result = await verifyWalletChallenge({ challengeId: challenge.challengeId, signature });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success("Stellar wallet linked");
        router.refresh();
      } catch (err) {
        const message = walletUserMessage(err);
        if (message) setError(message);
      }
    });

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={connect}
        disabled={pending}
        className={mode === "login" ? "h-11 w-full text-base font-semibold" : "h-10 px-4"}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Wallet aria-hidden />}
        Connect a Stellar wallet
      </Button>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
