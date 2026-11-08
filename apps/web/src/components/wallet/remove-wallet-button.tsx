"use client";

import { useTransition } from "react";
import { Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { removeFreighterWallet } from "@/app/account/wallet-actions";
import { Button } from "@/components/ui/button";

export function RemoveWalletButton({ walletId }: { walletId: string }) {
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!window.confirm("Unlink this Stellar wallet from BY Tickets? Tickets already in it stay in it.")) return;
    startTransition(async () => {
      const result = await removeFreighterWallet(walletId);
      if (result.ok) toast.success("Wallet unlinked");
      else toast.error(result.error);
    });
  };

  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={remove} disabled={pending} aria-label="Unlink Stellar wallet">
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Unlink aria-hidden />}
    </Button>
  );
}
