import { describe, expect, it } from "vitest";
import { assertOrganizerEvent, assertOwnTicket } from "./access";

describe("authorization helpers", () => {
  it("allows the ticket owner", () => {
    expect(() => assertOwnTicket({ owner_user_id: "u1", owner_public_key: "GAAA" }, "u1")).not.toThrow();
  });

  it("rejects another user's ticket", () => {
    expect(() => assertOwnTicket({ owner_user_id: "u1", owner_public_key: "GAAA" }, "u2")).toThrow(/not yours/);
  });

  it("allows the event organizer", () => {
    expect(() => assertOrganizerEvent({ organizer_id: "org1" }, "org1")).not.toThrow();
    expect(() => assertOrganizerEvent({ organizer_id: "org1" }, "org2")).toThrow(/not yours/);
  });
});
