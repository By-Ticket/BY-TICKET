import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getViewer } from "@/lib/auth/session";
import { formatPrice } from "@/lib/payments/pricing";
import { explorerUrl, stellarConfig } from "@/lib/stellar/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BuyPanel } from "./buy-panel";

function when(iso: string) {
  return new Intl.DateTimeFormat("en-ZM", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Lusaka",
  }).format(new Date(iso));
}

export async function generateMetadata({ params }: PageProps<"/events/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("events").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Event" };
}

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, summary, description, city, venue_name, venue_address, starts_at, capacity, tickets_sold, max_transfers, resale_cap_units, sales_open, chain_event_id, organizer_id",
    )
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();
  if (!event) notFound();

  const { data: tiers } = await supabase
    .from("ticket_tiers")
    .select("id, name, description, price_units, capacity, sold, chain_tier")
    .eq("event_id", event.id)
    .order("sort_order");
  const tier = tiers?.[0];
  if (!tier) notFound();

  const { data: organizer } = await supabase.from("organizers").select("name").eq("id", event.organizer_id).maybeSingle();
  const viewer = await getViewer();
  const { data: wallets } = viewer
    ? await supabase.from("wallets").select("id, kind, public_key").order("created_at")
    : { data: [] };

  const price = formatPrice(BigInt(tier.price_units));
  const resale = formatPrice(BigInt(event.resale_cap_units));
  const soldOut = !event.sales_open || event.tickets_sold >= event.capacity || tier.sold >= tier.capacity;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[1fr_320px]">
      <article className="space-y-4">
        <p className="text-muted-foreground text-sm">
          <Link href="/events" className="hover:text-foreground underline">
            Events
          </Link>
          {organizer?.name ? ` · ${organizer.name}` : ""}
        </p>
        <h1 className="font-heading text-4xl font-extrabold">{event.title}</h1>
        <p className="text-lg">{event.summary}</p>
        <div className="text-muted-foreground space-y-1 text-sm">
          <p className="flex items-center gap-2">
            <CalendarDays className="size-4" aria-hidden />
            {when(event.starts_at)} CAT
          </p>
          <p className="flex items-center gap-2">
            <MapPin className="size-4" aria-hidden />
            {event.venue_name}
            {event.venue_address ? `, ${event.venue_address}` : ""}, {event.city}
          </p>
        </div>
        <p className="max-w-2xl text-sm leading-6">{event.description}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{event.max_transfers === 0 ? "Non-transferable" : `${event.max_transfers} transfer`}</Badge>
          <Badge variant="outline">Resale cap {resale.usdc}</Badge>
          {event.chain_event_id && (
            <Badge variant="secondary">On-chain event #{event.chain_event_id}</Badge>
          )}
        </div>
      </article>

      <aside className="bg-card h-fit space-y-4 rounded-2xl border p-5">
        <div>
          <h2 className="font-heading text-xl font-extrabold">{tier.name}</h2>
          <p className="text-muted-foreground text-sm">{tier.description}</p>
        </div>
        <p className="font-heading text-3xl font-extrabold">{price.zmw}</p>
        <p className="text-muted-foreground text-sm">{price.usdc} on Stellar testnet</p>
        <p className="text-xs">
          {tier.sold} of {tier.capacity} sold
        </p>
        <BuyPanel
          eventId={event.id}
          tierId={tier.id}
          soldOut={soldOut}
          wallets={(wallets ?? []).map((wallet) => ({
            id: wallet.id,
            kind: wallet.kind,
            publicKey: wallet.public_key,
          }))}
        />
        {stellarConfig.contracts.eventTicket && (
          <a
            href={explorerUrl("contract", stellarConfig.contracts.eventTicket)}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground block text-xs underline"
          >
            View the ticket contract
          </a>
        )}
      </aside>
    </div>
  );
}
