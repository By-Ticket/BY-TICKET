import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import type { OrganizerStatus } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Admin" };

const STATUS_VARIANT: Record<OrganizerStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "default",
  approved: "secondary",
  rejected: "outline",
  suspended: "destructive",
};

export default async function AdminPage() {
  await requireRole("admin", "/admin");
  const supabase = await createSupabaseServerClient();
  const [{ data: stats }, { data: organizers }] = await Promise.all([
    supabase.rpc("admin_stats"),
    supabase.rpc("admin_list_organizers", {}),
  ]);
  const s = (stats ?? {}) as Record<string, number | string>;
  const tiles = [
    ["Users", s.users],
    ["Pending organizers", s.organizers_pending],
    ["Approved organizers", s.organizers_approved],
    ["Live events", s.events_published],
    ["Tickets sold", s.tickets_sold],
    ["Checked in", s.tickets_checked_in],
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-[28px] leading-8 font-semibold">Platform admin</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="shadow-soft rounded-xl border border-border bg-card p-4">
            <p className="text-muted-foreground text-[13px]">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value ?? 0}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizers</CardTitle>
          <CardDescription>
            Approving grants the organizer role. On-chain approval (the contract&apos;s organizer allow-list) is
            synced when event publishing ships.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(organizers ?? []).length === 0 && <p className="text-muted-foreground text-sm">No applications yet.</p>}
          {(organizers ?? []).map((o) => (
            <div key={o.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_minmax(0,22rem)]">
              <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.name}</span>
                  <Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge>
                  {o.on_chain_approved_at && <Badge variant="outline">on-chain</Badge>}
                </div>
                <p className="text-muted-foreground">
                  {o.city} · {o.contact_email} · {o.contact_phone}
                </p>
                <p className="text-muted-foreground text-xs">
                  Account {o.user_email} · applied {new Date(o.created_at).toLocaleDateString("en-ZM")}
                </p>
                {o.review_note && <p className="text-xs">Note: {o.review_note}</p>}
              </div>
              {o.status !== "rejected" && <ReviewForm organizerId={o.id} status={o.status} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
