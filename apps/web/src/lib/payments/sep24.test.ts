import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { MOCK_USDC } from "@/lib/stellar/usdc";
import { Sep24RampAdapter, anchorOffersAsset, assetEnabled, parseSep24Webhook, type Sep24Info } from "./sep24";
import { mapSep24Status } from "./status";
import type { AnchorToml } from "./toml";

const toml: AnchorToml = {
  homeDomain: "testanchor.stellar.org",
  signingKey: "GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR",
  webAuthEndpoint: "https://testanchor.stellar.org/auth",
  transferServerSep24: "https://testanchor.stellar.org/sep24",
  kycServer: "https://testanchor.stellar.org/sep12",
  currencies: [{ code: "USDC" }],
};

const info: Sep24Info = {
  deposit: { USDC: { enabled: true }, SRT: { enabled: true } },
  withdraw: { USDC: { enabled: false }, SRT: { enabled: true } },
};

describe("SEP-24 adapter (mocked fetch)", () => {
  it("reports whether /info offers the ticket asset", () => {
    expect(assetEnabled(info, "deposit", "USDC")).toBe(true);
    expect(assetEnabled(info, "withdraw", "USDC")).toBe(false);
    expect(assetEnabled(info, "deposit", "ZMW")).toBe(false);
  });

  it("rejects a USDC code whose issuer is not in stellar.toml", () => {
    const withIssuer: typeof toml = {
      ...toml,
      currencies: [{ code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }],
    };
    expect(anchorOffersAsset(info, withIssuer, "deposit", { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" })).toBe(true);
    expect(
      anchorOffersAsset(info, withIssuer, "deposit", {
        code: "USDC",
        issuer: MOCK_USDC.issuer,
      }),
    ).toBe(false);
  });

  it("starts an interactive deposit and maps incomplete", async () => {
    let posted = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/info")) return Response.json(info);
      if (url.includes("/deposit/interactive") && init?.method === "POST") {
        posted = String(init.body);
        return Response.json({ type: "interactive_customer_info_needed", url: "https://anchor.test/widget", id: "tx_1" });
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    const adapter = new Sep24RampAdapter(toml, "jwt", fetchImpl);
    const session = await adapter.startOnRamp({
      reference: "ref-1",
      amountNgwee: 100n,
      amountUsdc: "10",
      phone: "+260971234567",
      destination: Keypair.random().publicKey(),
      assetCode: "USDC",
    });
    expect(posted).toContain("amount=10");
    expect(session.providerReference).toBe("tx_1");
    expect(session.interactiveUrl).toBe("https://anchor.test/widget");
    expect(session.status).toBe("awaiting_customer");
    expect(mapSep24Status("incomplete")).toBe(session.status);
  });

  it("polls /transaction until completed", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/transaction")) {
        return Response.json({ transaction: { id: "tx_1", kind: "deposit", status: "completed", amount_in: "10" } });
      }
      throw new Error(url);
    }) as unknown as typeof fetch;
    const adapter = new Sep24RampAdapter(toml, "jwt", fetchImpl);
    const session = await adapter.getStatus("tx_1");
    expect(session.status).toBe("settled");
  });

  it("parses Anchor Platform transaction callbacks", async () => {
    const body = JSON.stringify({
      transaction: { id: "tx_cb", kind: "withdraw", status: "completed", amount_in: "12.5" },
    });
    const parsed = parseSep24Webhook(body);
    expect(parsed.providerReference).toBe("tx_cb");
    expect(parsed.status).toBe("settled");
    const adapter = new Sep24RampAdapter(toml, "jwt", vi.fn() as unknown as typeof fetch);
    await expect(adapter.parseWebhook(new Headers(), body)).resolves.toMatchObject({ status: "settled", providerReference: "tx_cb" });
  });
});
