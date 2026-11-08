import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, LogOut, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectStellarWallet } from "@/components/wallet/connect-stellar";
import { RemoveWalletButton } from "@/components/wallet/remove-wallet-button";
import { isStellarWalletEmail } from "@/lib/auth/stellar-wallet";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireViewer } from "@/lib/auth/session";
import { explorerUrl } from "@/lib/stellar/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Account" };

const shortKey = (k: string) => `${k.slice(0, 6)}…${k.slice(-6)}`;

export default async function AccountPage() {
  const viewer = await requireViewer("/account");
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: wallets }] = await Promise.all([
    supabase.from("profiles").select("display_name, phone, city").eq("id", viewer.id).single(),
    supabase.from("wallets").select("id, kind, public_key, is_primary, activated_at, verified_at").order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-8 font-semibold">Your account</h1>
          <p className="text-muted-foreground text-sm">
            {isStellarWalletEmail(viewer.email) ? "Signed in with a Stellar wallet" : viewer.email}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {viewer.roles.map((r) => (
              <Badge key={r} variant={r === "customer" ? "secondary" : "outline"}>
                {ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            <LogOut aria-hidden />
            Sign out
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Organizers see your name on tickets you buy. Your phone stays private.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile ?? { display_name: null, phone: null, city: null }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" aria-hidden />
            Wallets
          </CardTitle>
          <CardDescription>
            Your tickets, BY Points and badges live on the Stellar network. We manage a wallet for you, so you never
            need crypto to use BY Tickets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(wallets ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">Your wallet is being set up. Refresh in a moment.</p>
          )}
          {(wallets ?? []).map((w) => (
            <div key={w.id} className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <span className="font-medium">{w.kind === "custodial" ? "BY Tickets wallet" : "Stellar wallet"}</span>
              {w.is_primary && <Badge variant="secondary">Primary</Badge>}
              {w.kind === "custodial" && !w.activated_at && <Badge variant="outline">Activates on first purchase</Badge>}
              {w.kind === "freighter" && w.verified_at && <Badge variant="outline">Verified</Badge>}
              <Link
                href={explorerUrl("account", w.public_key)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 font-mono text-xs"
              >
                {shortKey(w.public_key)}
                <ExternalLink className="size-3" aria-hidden />
              </Link>
              {w.kind === "freighter" && !w.is_primary && <RemoveWalletButton walletId={w.id} />}
            </div>
          ))}
          <div className="space-y-1 pt-2">
            <p className="text-muted-foreground text-xs">
              Have a Stellar wallet? Link it to pay with it and keep tickets there. You&apos;ll sign a one-time message;
              it doesn&apos;t move any funds.
            </p>
            <ConnectStellarWallet mode="link" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
