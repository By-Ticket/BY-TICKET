import type { Metadata } from "next";
import { Clock, LayoutDashboard, OctagonX } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ApplicationForm } from "./application-form";
import { CashOutPanel } from "./cash-out";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage() {
  const viewer = await requireViewer("/organizer");
  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase.rpc("my_organizer").maybeSingle();

  if (org?.status === "approved") {
    const { data: wallets } = await supabase.from("wallets").select("id, kind, public_key").order("created_at");
    return (
      <>
        <PhasePlaceholder
          title={`Welcome, ${org.name}`}
          phase={6}
          icon={LayoutDashboard}
          description="You're approved to sell tickets. Your dashboard is on its way."
          features={[
            "Create and edit events, ticket tiers, capacity and pricing",
            "Transfer limits and resale price caps",
            "Revenue split between organizer, artist and platform",
            "Sales analytics, attendee list and payouts",
          ]}
        />
        <div className="mx-auto max-w-xl px-4 pb-8">
          <Card>
            <CardHeader>
              <CardTitle>Cash out to local currency</CardTitle>
              <CardDescription>
                After <span className="font-medium">release_payout</span> sends USDC to your Stellar wallet, withdraw
                through the Stellar anchor (SEP-24).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CashOutPanel
                wallets={(wallets ?? []).map((wallet) => ({
                  id: wallet.id,
                  kind: wallet.kind,
                  publicKey: wallet.public_key,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </>
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
