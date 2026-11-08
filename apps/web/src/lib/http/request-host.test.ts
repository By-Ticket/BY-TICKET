import { describe, expect, it } from "vitest";
import { resolveAppHost } from "./request-host";

const app = "http://localhost:3000";

describe("resolveAppHost", () => {
  it("uses a Cloudflare quick-tunnel hostname", () => {
    expect(resolveAppHost("cocktail-newton-enjoy-gathered.trycloudflare.com", app)).toBe(
      "cocktail-newton-enjoy-gathered.trycloudflare.com",
    );
  });

  it("keeps localhost, including a port", () => {
    expect(resolveAppHost("localhost:3000", app)).toBe("localhost:3000");
  });

  it("ignores an unknown Host header", () => {
    expect(resolveAppHost("evil.example", app)).toBe("localhost:3000");
  });
});
