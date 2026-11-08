import { describe, expect, it } from "vitest";
import { isTerminalRampStatus, mapSep24Status } from "./status";

describe("mapSep24Status", () => {
  it("maps completed to settled", () => {
    expect(mapSep24Status("completed")).toBe("settled");
  });

  it("maps customer-facing waits to awaiting_customer", () => {
    expect(mapSep24Status("incomplete")).toBe("awaiting_customer");
    expect(mapSep24Status("pending_user")).toBe("awaiting_customer");
    expect(mapSep24Status("pending_user_transfer_start")).toBe("awaiting_customer");
  });

  it("maps processing states to pending", () => {
    expect(mapSep24Status("pending_anchor")).toBe("pending");
    expect(mapSep24Status("pending_stellar")).toBe("pending");
    expect(mapSep24Status("pending_user_transfer_complete")).toBe("pending");
  });

  it("maps failures, refunds and expiry", () => {
    expect(mapSep24Status("error")).toBe("error");
    expect(mapSep24Status("too_small")).toBe("error");
    expect(mapSep24Status("refunded")).toBe("refunded");
    expect(mapSep24Status("expired")).toBe("expired");
  });

  it("knows which statuses are terminal", () => {
    expect(isTerminalRampStatus("settled")).toBe(true);
    expect(isTerminalRampStatus("refunded")).toBe(true);
    expect(isTerminalRampStatus("pending")).toBe(false);
    expect(isTerminalRampStatus("awaiting_customer")).toBe(false);
  });
});
