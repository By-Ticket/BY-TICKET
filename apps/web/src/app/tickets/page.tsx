import type { Metadata } from "next";
import Link from "next/link";
import { CashOutPanel } from "@/app/organizer/cash-out";
import { requireViewer } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketPanel } from "./ticket-panel";

export const metadata: Metadata = { title: "My Tickets" };

export default async function MyTicketsPage() {
  const viewer = await requireViewer("/tickets");
  const supabase = await createSupabaseServerClient();
  const [{ data: tickets }, { data: wallets }, { data: kyc }, { data: proceeds }] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, chain_ticket_id, status, created_at, events(title, city, starts_at, status), ticket_listings(id, status, fiat_payout)")
      .eq("owner_user_id", viewer.id)
      .order("created_at", { ascending: false }),
    supabase.from("wallets").select("id, kind, public_key").order("created_at"),
    supabase.from("kyc_customers").select("status").eq("user_id", viewer.id).maybeSingle(),
    supabase
      .from("ticket_listings")
      .select("id, price_units")
      .eq("seller_user_id", viewer.id)
      .eq("status", "sold")
      .eq("fiat_payout", true),
  ]);

  const walletChoices = (wallets ?? []).map((wallet) => ({
    id: wallet.id,
    kind: wallet.kind,
    publicKey: wallet.public_key,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-heading text-3xl font-bold">My tickets</h1>
        <p className="text-muted-foreground text-sm">
          The door QR arrives in the next step. These tickets are already yours on Stellar. Cancelled events can be refunded
          on-chain.
        </p>
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
          const listings = Array.isArray(ticket.ticket_listings) ? ticket.ticket_listings : ticket.ticket_listings ? [ticket.ticket_listings] : [];
          const open = listings.find((listing) => listing.status === "listed" || listing.status === "reserved");
          return (
            <TicketPanel
              key={ticket.id}
              ticketId={ticket.id}
              chainTicketId={ticket.chain_ticket_id}
              title={event?.title ?? "Event"}
              city={event?.city}
              status={ticket.status}
              eventStatus={event?.status ?? "published"}
              listingStatus={open?.status}
              listingId={open?.id}
              reserved={open?.status === "reserved"}
              wallets={walletChoices}
            />
          );
        })}
      </ul>
      {(proceeds ?? []).length > 0 && (
        <div className="space-y-2 rounded-xl border p-4">
          <p className="font-medium">Cash out resale proceeds</p>
          <p className="text-muted-foreground text-sm">
            Identity verification runs before the Stellar anchor pays you in local currency, the same as organizer cash-out.
          </p>
          <CashOutPanel wallets={walletChoices} kycStatus={kyc?.status} />
        </div>
      )}
    </div>
  );
}
