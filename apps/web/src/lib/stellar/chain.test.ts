import { describe, expect, it } from "vitest";
import { bytesToHex, unwrapResult } from "./chain";

describe("chain helpers", () => {
  it("reads a 32-byte metadata hash from a numeric map", () => {
    const bytes = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i, i]));
    expect(bytesToHex(bytes)).toBe(Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("hex"));
  });

  it("unwraps a contract Result", () => {
    expect(unwrapResult({ unwrap: () => 7n })).toBe(7n);
    expect(unwrapResult(4)).toBe(4);
  });
});
