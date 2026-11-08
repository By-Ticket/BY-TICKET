import type { Metadata } from "next";
import { Clock, LayoutDashboard, OctagonX } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApplicationForm } from "./application-form";
import { CashOutPanel } from "./cash-out";
import { EventForm } from "./event-form";
import { EventManage } from "./event-manage";
import { loadEventChainState } from "./event-actions";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage() {
  const viewer = await requireViewer("/organizer");
  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase.rpc("my_organizer").maybeSingle();

  if (org?.status === "approved") {
    const [{ data: wallets }, { data: kyc }, { data: events }] = await Promise.all([
      supabase.from("wallets").select("id, kind, public_key").order("created_at"),
      supabase.from("kyc_customers").select("status").eq("user_id", viewer.id).maybeSingle(),
      supabase
        .from("events")
        .select("id, title, status, chain_event_id, starts_at")
        .eq("organizer_id", org.id)
        .order("starts_at", { ascending: false }),
    ]);
    const walletChoices = (wallets ?? []).map((wallet) => ({
      id: wallet.id,
      kind: wallet.kind,
      publicKey: wallet.public_key,
    }));
    const payoutsByEvent = new Map<string, { id: string; amount_units: number }>();
    if ((events ?? []).length > 0) {
      const { data: payouts } = await supabase
        .from("event_payouts")
        .select("id, event_id, amount_units, created_at")
        .in(
          "event_id",
          (events ?? []).map((event) => event.id),
        )
        .order("created_at", { ascending: false });
      for (const payout of payouts ?? []) {
        if (!payoutsByEvent.has(payout.event_id)) payoutsByEvent.set(payout.event_id, payout);
      }
    }
    const chainStates = await Promise.all(
      (events ?? []).map(async (event) => {
        if (!event.chain_event_id) return { event, chain: null as Awaited<ReturnType<typeof loadEventChainState>> | null };
        try {
          return { event, chain: await loadEventChainState(event.chain_event_id) };
        } catch {
          return { event, chain: null };
        }
      }),
    );
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="font-heading text-3xl font-bold">Welcome, {org.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">Create events on Stellar, complete them after the end time, and cash out released USDC.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutDashboard className="size-5" aria-hidden />
              Create an event
            </CardTitle>
            <CardDescription>Calls create_event with ends_at and a resale royalty capped at 15%.</CardDescription>
          </CardHeader>
          <CardContent>
            <EventForm wallets={walletChoices} />
          </CardContent>
        </Card>
        {(chainStates ?? []).map(({ event, chain }) =>
          event.chain_event_id ? (
            <EventManage
              key={event.id}
              eventId={event.id}
              title={event.title}
              chainEventId={event.chain_event_id}
              dbStatus={event.status}
              chainStatus={chain?.status ?? event.status}
              escrow={chain?.escrow ?? 0n}
              payoutReleased={chain?.payoutReleased ?? false}
              wallets={walletChoices}
              kycStatus={kyc?.status}
              lastPayoutId={payoutsByEvent.get(event.id)?.id}
              lastPayoutUnits={payoutsByEvent.get(event.id)?.amount_units}
              ended={chain?.ended ?? true}
            />
          ) : (
            <Card key={event.id}>
              <CardHeader>
                <CardTitle>{event.title}</CardTitle>
                <CardDescription>This event is not on-chain yet, so payout and refund actions are unavailable.</CardDescription>
              </CardHeader>
            </Card>
          ),
        )}
        <Card>
          <CardHeader>
            <CardTitle>Cash out to local currency</CardTitle>
            <CardDescription>
              After <span className="font-medium">release_payout</span> sends USDC to your Stellar wallet, withdraw through the Stellar
              anchor (SEP-24).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CashOutPanel kycStatus={kyc?.status} wallets={walletChoices} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-[28px] leading-8 font-semibold">Sell tickets on BY</h1>
        <p className="text-muted-foreground mt-1">
          Tickets that can&apos;t be faked, payouts split automatically with your artists, and fans who earn rewards
          for showing up.
        </p>
      </div>

      {org?.status === "pending" && (
        <StatusCard
          icon={<Clock className="size-5" aria-hidden />}
          title="Application under review"
          text={`Thanks, ${org.name}. We review new organizers within 2 working days and will email ${org.contact_email ?? viewer.email}.`}
        />
      )}
      {org?.status === "suspended" && (
        <StatusCard
          icon={<OctagonX className="text-destructive size-5" aria-hidden />}
          title="Organizer account suspended"
          text="Contact the BY Tickets team to resolve this."
        />
      )}

      {(!org || org.status === "rejected") && (
        <Card>
          <CardHeader>
            <CardTitle>{org ? "Update your application" : "Apply to become an organizer"}</CardTitle>
            {org?.review_note && (
              <CardDescription className="border-sun/40 bg-sun/10 text-foreground rounded-lg border p-3">
                <span className="font-medium">Reviewer note:</span> {org.review_note}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <ApplicationForm
              resubmit={Boolean(org)}
              defaults={org ?? { contact_email: viewer.email, name: viewer.displayName }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}
