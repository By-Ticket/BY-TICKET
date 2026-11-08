import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl, isProtectedPath, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/tickets", "/tickets"],
    ["/events/abc?tier=vip#buy", "/events/abc?tier=vip#buy"],
    ["/organizer/../admin", "/admin"],
  ])("keeps in-app path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"),
    "javascript:alert(1)",
    "tickets",
    "",
    null,
    undefined,
    `/${"a".repeat(600)}`,
  ])("falls back for unsafe target %s", (input) => {
    expect(safeNextPath(input, "/home")).toBe("/home");
  });
});

describe("isLocalSupabaseUrl", () => {
  it("accepts only loopback Supabase URLs", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://example.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
    expect(isLocalSupabaseUrl(undefined)).toBe(false);
  });
});

describe("isProtectedPath", () => {
  it("matches protected sections and their children only", () => {
    expect(isProtectedPath("/tickets")).toBe(true);
    expect(isProtectedPath("/admin/fees")).toBe(true);
    expect(isProtectedPath("/events")).toBe(false);
    expect(isProtectedPath("/ticketshop")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });
});
