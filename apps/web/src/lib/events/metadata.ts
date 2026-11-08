import { createHash } from "node:crypto";

/** Canonical SHA-256 of the off-chain event record stored as `metadata_hash` on-chain. */
export function eventMetadataHash(fields: {
  title: string;
  venue_name: string;
  city: string;
  starts_at: string;
  ends_at: string | null;
  capacity: number;
}): { bytes: Uint8Array; hex: string } {
  const canonical = JSON.stringify({
    title: fields.title.trim(),
    venue_name: fields.venue_name.trim(),
    city: fields.city.trim(),
    starts_at: fields.starts_at,
    ends_at: fields.ends_at,
    capacity: fields.capacity,
  });
  const bytes = new Uint8Array(createHash("sha256").update(canonical).digest());
  return { bytes, hex: Buffer.from(bytes).toString("hex") };
}
