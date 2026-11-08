import { describe, expect, it } from "vitest";
import { evaluateKycGate, mapSep12Status, parseStoredKycFields } from "./kyc-status";

describe("mapSep12Status", () => {
  it("maps anchor statuses", () => {
    expect(mapSep12Status("ACCEPTED")).toBe("accepted");
    expect(mapSep12Status("processing")).toBe("processing");
    expect(mapSep12Status("NEEDS_INFO")).toBe("needs_info");
    expect(mapSep12Status("REJECTED")).toBe("rejected");
    expect(mapSep12Status("unknown")).toBe("needs_info");
  });
});

describe("parseStoredKycFields", () => {
  it("reads field names stored for the form", () => {
    expect(parseStoredKycFields([{ name: "last_name", type: "string", description: "Last name" }])[0]?.name).toBe(
      "last_name",
    );
    expect(parseStoredKycFields("nope")).toEqual([]);
  });
});

describe("evaluateKycGate", () => {
  const fields = [{ name: "first_name", type: "string" as const, description: "First name" }];

  it("lets stub-like accepted deposits through", () => {
    expect(evaluateKycGate({ kind: "deposit", status: "accepted", fields: [], amountUsdc: 100, thresholdUsdc: 0 }).action).toBe(
      "allow",
    );
  });

  it("keeps deposits pending while the anchor reviews", () => {
    expect(
      evaluateKycGate({ kind: "deposit", status: "processing", fields: [], amountUsdc: 20, thresholdUsdc: 0 }).action,
    ).toBe("pending");
  });

  it("does not skip KYC when the threshold is 0", () => {
    expect(
      evaluateKycGate({ kind: "deposit", status: "needs_info", fields, amountUsdc: 0.5, thresholdUsdc: 0 }).action,
    ).toBe("form");
  });

  it("shows a form when the anchor needs info", () => {
    const gate = evaluateKycGate({ kind: "deposit", status: "needs_info", fields, amountUsdc: 100, thresholdUsdc: 0 });
    expect(gate.action).toBe("form");
    if (gate.action === "form") expect(gate.fields[0]?.name).toBe("first_name");
  });

  it("skips KYC below the threshold unless rejected", () => {
    expect(
      evaluateKycGate({ kind: "deposit", status: "needs_info", fields, amountUsdc: 5, thresholdUsdc: 10 }).action,
    ).toBe("allow");
    expect(
      evaluateKycGate({ kind: "deposit", status: "rejected", fields: [], amountUsdc: 1, thresholdUsdc: 10 }).action,
    ).toBe("block");
  });

  it("blocks cash-out until ACCEPTED", () => {
    expect(evaluateKycGate({ kind: "withdraw", status: "needs_info", fields, amountUsdc: 1, thresholdUsdc: 1000 }).action).toBe(
      "form",
    );
    expect(evaluateKycGate({ kind: "withdraw", status: "processing", fields: [], amountUsdc: 1, thresholdUsdc: 0 }).action).toBe(
      "pending",
    );
    expect(evaluateKycGate({ kind: "withdraw", status: "accepted", fields: [], amountUsdc: 50, thresholdUsdc: 0 }).action).toBe(
      "allow",
    );
  });
});
