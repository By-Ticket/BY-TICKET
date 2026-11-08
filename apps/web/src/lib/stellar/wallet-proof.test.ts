import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { sep53Hash, verifyWalletSignature, walletChallengeMessage } from "./wallet-proof";

const wallet = Keypair.random();
const message = walletChallengeMessage({
  domain: "localhost:3000",
  publicKey: wallet.publicKey(),
  networkPassphrase: "Test SDF Network ; September 2015",
  nonce: "a".repeat(64),
  expiresAt: new Date("2026-10-26T12:00:00.000Z"),
});

describe("wallet ownership proof", () => {
  it("accepts a SEP-53 signature (current Freighter) in base64", () => {
    const sig = Buffer.from(wallet.sign(sep53Hash(message))).toString("base64");
    expect(verifyWalletSignature(wallet.publicKey(), message, sig)).toBe(true);
  });

  it("accepts the legacy SHA-256 signature in hex", () => {
    const sig = Buffer.from(wallet.sign(createHash("sha256").update(message).digest())).toString("hex");
    expect(verifyWalletSignature(wallet.publicKey(), message, sig)).toBe(true);
  });

  it("rejects a signature from a different wallet", () => {
    const sig = Buffer.from(Keypair.random().sign(sep53Hash(message))).toString("base64");
    expect(verifyWalletSignature(wallet.publicKey(), message, sig)).toBe(false);
  });

  it("rejects a signature over a different message (e.g. another nonce)", () => {
    const sig = Buffer.from(wallet.sign(sep53Hash(message.replace("aaaa", "bbbb")))).toString("base64");
    expect(verifyWalletSignature(wallet.publicKey(), message, sig)).toBe(false);
  });

  it("rejects malformed signatures and keys", () => {
    expect(verifyWalletSignature(wallet.publicKey(), message, "not-a-signature")).toBe(false);
    expect(verifyWalletSignature("GBAD", message, Buffer.alloc(64).toString("base64"))).toBe(false);
  });

  it("puts the domain, wallet, network and expiry in the signed text", () => {
    expect(message).toContain("BY Tickets: link this Stellar wallet to your account.");
    expect(message).toContain("Domain: localhost:3000");
    expect(message).toContain(`Wallet: ${wallet.publicKey()}`);
    expect(message).toContain("Network: Test SDF Network ; September 2015");
    expect(message).toContain("Expires: 2026-10-26T12:00:00.000Z");
  });

  it("accepts a signature over the raw UTF-8 message", () => {
    const sig = Buffer.from(wallet.sign(Buffer.from(message, "utf8"))).toString("base64");
    expect(verifyWalletSignature(wallet.publicKey(), message, sig)).toBe(true);
  });

  it("names sign-in in the login challenge text", () => {
    const login = walletChallengeMessage({
      purpose: "login",
      domain: "localhost:3000",
      publicKey: wallet.publicKey(),
      networkPassphrase: "Test SDF Network ; September 2015",
      nonce: "b".repeat(64),
      expiresAt: new Date("2026-10-26T12:00:00.000Z"),
    });
    expect(login).toContain("BY Tickets: sign in with this Stellar wallet.");
    expect(login).not.toContain("link this Stellar wallet");
  });
});
