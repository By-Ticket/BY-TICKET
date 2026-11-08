import { describe, expect, it } from "vitest";
import { quoteResale, refundAllowed, resaleAllowed, resaleOwnerPatch, royaltyPercentToBps, unixSeconds } from "./resale";

const UNIT = 10_000_000n;

describe("quoteResale", () => {
  it("splits fee, royalty and seller the same way as the contract", () => {
    const quoted = quoteResale(20n * UNIT, 250, 1_000);
    expect(quoted.fee).toBe(20n * UNIT * 250n / 10_000n);
    expect(quoted.royalty).toBe(20n * UNIT * 1_000n / 10_000n);
    expect(quoted.seller).toBe(quoted.price - quoted.fee - quoted.royalty);
    expect(quoted.fee + quoted.royalty + quoted.seller).toBe(quoted.price);
  });
});

describe("royaltyPercentToBps", () => {
  it("caps at 15%", () => {
    expect(royaltyPercentToBps("10")).toBe(1_000);
    expect(royaltyPercentToBps("15")).toBe(1_500);
    expect(royaltyPercentToBps("40")).toBe(1_500);
    expect(royaltyPercentToBps("-1")).toBe(0);
  });
});

describe("resaleAllowed", () => {
  const base = {
    eventStatus: "Live",
    checkedIn: false,
    refunded: false,
    transfers: 0,
    maxTransfers: 2,
    price: 10n * UNIT,
    resaleCap: 25n * UNIT,
  };

  it("allows a live ticket under the cap", () => {
    expect(resaleAllowed(base).ok).toBe(true);
  });

  it("blocks cancelled events, used tickets and prices over the cap", () => {
    expect(resaleAllowed({ ...base, eventStatus: "Cancelled" }).ok).toBe(false);
    expect(resaleAllowed({ ...base, checkedIn: true }).ok).toBe(false);
    expect(resaleAllowed({ ...base, transfers: 2 }).ok).toBe(false);
    expect(resaleAllowed({ ...base, price: 26n * UNIT }).ok).toBe(false);
  });
});

describe("resaleOwnerPatch", () => {
  it("moves ownership to the buyer and increments transfers", () => {
    expect(
      resaleOwnerPatch({
        buyerUserId: "buyer",
        buyerPublicKey: "GBUY",
        sellerPublicKey: "GSELL",
        currentTransfers: 0,
      }),
    ).toEqual({ owner_user_id: "buyer", owner_public_key: "GBUY", transfers: 1 });
  });
});

describe("refundAllowed", () => {
  const base = { eventStatus: "Cancelled", refunded: false, owner: "GAAA", wallet: "GAAA" };

  it("allows the holder of a cancelled ticket", () => {
    expect(refundAllowed(base).ok).toBe(true);
  });

  it("blocks live events, already-refunded tickets, and the wrong wallet", () => {
    expect(refundAllowed({ ...base, eventStatus: "Live" }).ok).toBe(false);
    expect(refundAllowed({ ...base, refunded: true }).ok).toBe(false);
    expect(refundAllowed({ ...base, wallet: "GBBB" }).ok).toBe(false);
  });
});

describe("unixSeconds", () => {
  it("converts ISO times and treats empty as 0", () => {
    expect(unixSeconds("2026-11-21T21:00:00.000Z")).toBe(BigInt(Date.parse("2026-11-21T21:00:00.000Z") / 1000));
    expect(unixSeconds(null)).toBe(0n);
  });
});
