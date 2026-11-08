import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { resaleOwnerPatch } from "./resale";

/** Apply a confirmed on-chain `transfer_ticket` to the listing and ticket rows. Not a server action. */
export async function recordResale(listingId: string, txHash: string) {
  const admin = createSupabaseAdminClient();
  const { data: listing } = await admin.from("ticket_listings").select("*").eq("id", listingId).maybeSingle();
  if (!listing || listing.status === "sold") return;
  const { data: ticket } = await admin.from("tickets").select("transfers, event_id").eq("id", listing.ticket_id).maybeSingle();
  await admin
    .from("tickets")
    .update(
      resaleOwnerPatch({
        buyerUserId: listing.buyer_user_id,
        buyerPublicKey: listing.buyer_public_key,
        sellerPublicKey: listing.seller_public_key,
        currentTransfers: ticket?.transfers ?? 0,
      }),
    )
    .eq("id", listing.ticket_id);
  await admin.from("ticket_listings").update({ status: "sold" }).eq("id", listingId);
  await admin.from("ticket_transfers").insert({
    ticket_id: listing.ticket_id,
    from_public_key: listing.seller_public_key,
    to_public_key: listing.buyer_public_key ?? listing.seller_public_key,
    from_user_id: listing.seller_user_id,
    to_user_id: listing.buyer_user_id,
    price_units: listing.price_units,
    tx_hash: txHash,
  });
  revalidatePath("/tickets");
  if (ticket?.event_id) revalidatePath(`/events/${ticket.event_id}`);
}
