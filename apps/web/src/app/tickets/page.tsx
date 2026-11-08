import type { Metadata } from "next";
import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Tickets" };

export default async function MyTicketsPage() {
  const viewer = await requireViewer("/tickets");
  const supabase = await createSupabaseServerClient();
  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, chain_ticket_id, status, created_at, events(title, city, starts_at)")
    .eq("owner_user_id", viewer.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-heading text-3xl font-extrabold">My tickets</h1>
        <p className="text-muted-foreground text-sm">The door QR arrives in the next step. These tickets are already yours on Stellar.</p>
      </div>
      {(tickets ?? []).length === 0 && (
        <p className="text-muted-foreground text-sm">
          No tickets yet.{" "}
          <Link href="/events" className="underline">
            Browse events
          </Link>
        </p>
      )}
      <ul className="space-y-3">
        {(tickets ?? []).map((ticket) => {
          const event = Array.isArray(ticket.events) ? ticket.events[0] : ticket.events;
          return (
            <li key={ticket.id} className="rounded-xl border p-4">
              <p className="font-medium">{event?.title ?? "Event"}</p>
              <p className="text-muted-foreground text-sm">
                {event?.city} · ticket #{ticket.chain_ticket_id} · {ticket.status.replaceAll("_", " ")}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
