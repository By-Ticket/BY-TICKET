import { describe, expect, it } from "vitest";
import { CIRCLE_USDC, MOCK_USDC, resolvedUsdc } from "./usdc";

describe("resolvedUsdc", () => {
  it("defaults to Circle testnet and mainnet issuers", () => {
    expect(resolvedUsdc("testnet")).toEqual(CIRCLE_USDC.testnet);
    expect(resolvedUsdc("public")).toEqual(CIRCLE_USDC.public);
  });

  it("keeps an explicit mock issuer for local dev and tests", () => {
    expect(resolvedUsdc("testnet", MOCK_USDC.issuer, MOCK_USDC.contractId)).toEqual(MOCK_USDC);
  });
});
