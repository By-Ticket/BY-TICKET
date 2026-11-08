import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ensureDemoEvent } from "@/lib/events/demo-event";
import { formatPrice } from "@/lib/payments/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/client";

export const metadata: Metadata = { title: "Events" };

function when(iso: string) {
  return new Intl.DateTimeFormat("en-ZM", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lusaka",
  }).format(new Date(iso));
}

export default async function EventsPage() {
  if (!supabaseConfigured) {
    return <p className="text-muted-foreground mx-auto max-w-6xl px-4 py-10 text-sm">Events are not available yet.</p>;
  }

  let loadError: string | null = null;
  try {
    await ensureDemoEvent();
  } catch (error) {
    console.error("demo event seed failed", error instanceof Error ? error.message.slice(0, 300) : "");
    loadError = "The sample event could not be loaded.";
  }

  const supabase = await createSupabaseServerClient();
  const { data: events } = await supabase
    .from("events")
    .select("id, title, summary, city, venue_name, starts_at, tickets_sold, capacity, ticket_tiers(price_units, sort_order)")
    .eq("status", "published")
    .order("starts_at");

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-heading text-3xl font-bold">Events</h1>
        <p className="text-muted-foreground text-sm">Prices are shown in kwacha and charged in test USDC.</p>
      </div>
      {loadError && <p className="text-destructive text-sm">{loadError}</p>}
      {(events ?? []).length === 0 && <p className="text-muted-foreground text-sm">Nothing is on sale yet.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {(events ?? []).map((event) => {
          const tiers = [...(event.ticket_tiers ?? [])].sort((a, b) => a.sort_order - b.sort_order);
          const price = tiers[0] ? formatPrice(BigInt(tiers[0].price_units)) : null;
          return (
            <Link key={event.id} href={`/events/${event.id}`}>
              <Card className="h-full transition-transform hover:-translate-y-0.5">
                <div className="bg-brand h-1.5" aria-hidden />
                <CardHeader>
                  <CardTitle className="font-heading text-xl font-bold">{event.title}</CardTitle>
                  <CardDescription>{event.summary}</CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground space-y-1 text-sm">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="size-4" aria-hidden />
                    {when(event.starts_at)}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin className="size-4" aria-hidden />
                    {event.venue_name}, {event.city}
                  </p>
                  <p className="text-foreground pt-2 font-medium">
                    {price ? `${price.zmw} · ${price.usdc}` : "Price to be announced"}
                  </p>
                  <p className="text-xs">
                    {event.tickets_sold} of {event.capacity} sold
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
