import { describe, expect, it } from "vitest";
import { payoutLinkDenied } from "./payout-link";

describe("payoutLinkDenied", () => {
  const payout = { event_id: "evt-1" };
  const event = { id: "evt-1", organizer_id: "org-1" };

  it("allows the organizer who owns the event", () => {
    expect(payoutLinkDenied({ payout, event, organizerId: "org-1" })).toBe(false);
  });

  it("rejects another organizer, a missing payout, or a mismatched event", () => {
    expect(payoutLinkDenied({ payout, event, organizerId: "org-2" })).toBe(true);
    expect(payoutLinkDenied({ payout: null, event, organizerId: "org-1" })).toBe(true);
    expect(payoutLinkDenied({ payout, event: { id: "evt-2", organizer_id: "org-1" }, organizerId: "org-1" })).toBe(true);
  });
});
