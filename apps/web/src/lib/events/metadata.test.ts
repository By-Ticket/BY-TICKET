import { describe, expect, it } from "vitest";
import { eventMetadataHash } from "./metadata";

describe("eventMetadataHash", () => {
  it("is stable for the same fields and 32 bytes", () => {
    const fields = {
      title: "Copperbelt Night Live",
      venue_name: "Kitwe Civic Centre",
      city: "Kitwe",
      starts_at: "2026-11-21T17:00:00.000Z",
      ends_at: "2026-11-21T21:00:00.000Z",
      capacity: 200,
    };
    const a = eventMetadataHash(fields);
    const b = eventMetadataHash(fields);
    expect(a.hex).toBe(b.hex);
    expect(a.bytes).toHaveLength(32);
    expect(eventMetadataHash({ ...fields, title: "Other" }).hex).not.toBe(a.hex);
  });
});
