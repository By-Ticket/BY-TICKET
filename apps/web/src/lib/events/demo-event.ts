import "server-only";
import { chainConfig } from "@/lib/stellar/app-chain";
import { readOnChainEvent } from "@/lib/stellar/chain";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";

/** The event created by the testnet smoke test. Sales are still open. */
export const DEMO_CHAIN_EVENT_ID = 1n;

const DEMO_SLUG = "copperbelt-night-live";

/**
 * Mirror the on-chain smoke-test event into the database so it can be listed and sold.
 * Idempotent. The contract admin key is not available here, so this does not create a new event.
 */
export async function ensureDemoEvent(): Promise<void> {
  if (!supabaseAdminConfigured) return;
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from("events")
    .select("id")
    .eq("chain_event_id", Number(DEMO_CHAIN_EVENT_ID))
    .maybeSingle();
  if (existing) return;

  const onChain = await readOnChainEvent(chainConfig(), DEMO_CHAIN_EVENT_ID);
  const tier = onChain.tiers[0];
  if (!tier) throw new Error("On-chain event has no ticket tier");

  const { data: adminRole, error: roleError } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!adminRole) return;

  const { data: found, error: findError } = await admin
    .from("organizers")
    .select("id")
    .eq("user_id", adminRole.user_id)
    .maybeSingle();
  if (findError) throw findError;
  let organizerId = found?.id;
  if (!organizerId) {
    const { data: created, error: organizerError } = await admin
      .from("organizers")
      .insert({
        user_id: adminRole.user_id,
        name: "BY Tickets",
        slug: "by-tickets",
        city: "Kitwe",
        country: "ZM",
        contact_email: "alfredwalima@gmail.com",
        payout_public_key: onChain.organizer,
        status: "approved",
        on_chain_approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (organizerError) throw organizerError;
    organizerId = created.id;
  }

  const { data: event, error: eventError } = await admin
    .from("events")
    .insert({
      organizer_id: organizerId,
      title: "Copperbelt Night Live",
      slug: DEMO_SLUG,
      summary: "A testnet show. Tickets are real on Stellar and paid in test USDC.",
      description:
        "This is the sample event already created on the testnet ticket contract. The price is 100 test USDC. Nothing here is real money.",
      category: "music",
      artist_name: "The Testnet Band",
      venue_name: "Kitwe Civic Centre",
      venue_address: "Kitwe",
      city: "Kitwe",
      country: "ZM",
      starts_at: "2026-11-21T17:00:00.000Z",
      ends_at: "2026-11-21T21:00:00.000Z",
      timezone: "Africa/Lusaka",
      capacity: onChain.capacity,
      max_transfers: onChain.maxTransfers,
      resale_cap_units: Number(onChain.resaleCap),
      splits: onChain.splits.map((split, index) => ({
        recipient: split.recipient,
        bps: split.bps,
        label: index === 0 ? "Organizer" : "Artist",
      })),
      status: "published",
      sales_open: onChain.salesOpen,
      chain_event_id: Number(DEMO_CHAIN_EVENT_ID),
      metadata_hash: onChain.metadataHash,
      fee_bps: onChain.feeBps,
      tickets_sold: onChain.sold,
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  const { error: tierError } = await admin.from("ticket_tiers").insert({
    event_id: event.id,
    chain_tier: 0,
    name: "General admission",
    description: "One entry. Transfers and resale follow the limits shown on the event.",
    price_units: Number(tier.price),
    capacity: tier.capacity,
    sold: tier.sold,
    sort_order: 0,
  });
  if (tierError) throw tierError;
}
