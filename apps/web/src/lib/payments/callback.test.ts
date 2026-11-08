import { describe, expect, it } from "vitest";
import { hmacSha256Hex, verifyAnchorCallback } from "./callback";

const secret = "callback-secret-value-ok";

describe("verifyAnchorCallback", () => {
  it("accepts a Bearer shared secret", () => {
    const headers = new Headers({ authorization: `Bearer ${secret}` });
    expect(verifyAnchorCallback(headers, "{}", secret)).toBe(true);
  });

  it("accepts x-callback-secret", () => {
    const headers = new Headers({ "x-callback-secret": secret });
    expect(verifyAnchorCallback(headers, "{}", secret)).toBe(true);
  });

  it("accepts an HMAC of the body", () => {
    const body = JSON.stringify({ id: "cust_1", status: "ACCEPTED" });
    const headers = new Headers({ signature: `sha256=${hmacSha256Hex(secret, body)}` });
    expect(verifyAnchorCallback(headers, body, secret)).toBe(true);
  });

  it("rejects a missing or wrong secret", () => {
    expect(verifyAnchorCallback(new Headers(), "{}", secret)).toBe(false);
    expect(verifyAnchorCallback(new Headers({ authorization: "Bearer no" }), "{}", secret)).toBe(false);
    expect(verifyAnchorCallback(new Headers({ authorization: `Bearer ${secret}` }), "{}", undefined)).toBe(false);
    const headers = new Headers({ signature: `sha256=${hmacSha256Hex(secret, "other")}` });
    expect(verifyAnchorCallback(headers, "{}", secret)).toBe(false);
  });
});
