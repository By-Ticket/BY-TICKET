import { describe, expect, it } from "vitest";
import { parseStellarToml, TomlParseError } from "./toml";

const SAMPLE = `
ACCOUNTS = ["GCSGSR6KQQ5BP2FXVPWRL6SWPUSFWLVONLIBJZUKTVQB5FYJFVL6XOXE"]
VERSION = "0.1.0"
SIGNING_KEY = "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR"
NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
WEB_AUTH_ENDPOINT = "https://testanchor.stellar.org/auth"
KYC_SERVER = "https://testanchor.stellar.org/sep12"
TRANSFER_SERVER = "https://testanchor.stellar.org/sep6"
TRANSFER_SERVER_SEP0024 = "https://testanchor.stellar.org/sep24"

[[CURRENCIES]]
code = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

[[CURRENCIES]]
code = "native"
`;

describe("parseStellarToml", () => {
  it("reads SEP-10 and SEP-24 fields", () => {
    const toml = parseStellarToml("testanchor.stellar.org", SAMPLE);
    expect(toml.signingKey).toBe("GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR");
    expect(toml.webAuthEndpoint).toBe("https://testanchor.stellar.org/auth");
    expect(toml.transferServerSep24).toBe("https://testanchor.stellar.org/sep24");
    expect(toml.kycServer).toBe("https://testanchor.stellar.org/sep12");
    expect(toml.currencies.map((c) => c.code)).toEqual(["USDC", "native"]);
    expect(toml.currencies[0]?.issuer).toMatch(/^G/);
  });

  it("falls back to TRANSFER_SERVER when SEP-24 is missing", () => {
    const body = `
SIGNING_KEY = "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR"
WEB_AUTH_ENDPOINT = "https://example.com/auth"
TRANSFER_SERVER = "https://example.com/sep6"
`;
    const parsed = parseStellarToml("example.com", body);
    expect(parsed.transferServerSep24).toBe("https://example.com/sep6");
    expect(parsed.kycServer).toBe("https://example.com/sep6");
  });

  it("rejects a missing signing key", () => {
    expect(() => parseStellarToml("x", "WEB_AUTH_ENDPOINT = \"https://x/auth\"\nTRANSFER_SERVER_SEP0024 = \"https://x/24\"")).toThrow(
      TomlParseError,
    );
  });
});
