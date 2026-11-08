import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { Sep10Error, signChallengeXdr, verifySep10Challenge } from "./sep10";
import type { AnchorToml } from "./toml";

const homeDomain = "testanchor.stellar.org";
const webAuthHost = "testanchor.stellar.org";

function tomlFor(server: Keypair): AnchorToml {
  return {
    homeDomain,
    signingKey: server.publicKey(),
    webAuthEndpoint: `https://${webAuthHost}/auth`,
    transferServerSep24: `https://${webAuthHost}/sep24`,
    kycServer: `https://${webAuthHost}/sep12`,
    networkPassphrase: Networks.TESTNET,
    currencies: [],
  };
}

describe("SEP-10 challenge verification", () => {
  it("accepts a challenge signed by the anchor SIGNING_KEY", () => {
    const server = Keypair.random();
    const client = Keypair.random();
    const xdr = WebAuth.buildChallengeTx(server, client.publicKey(), homeDomain, 300, Networks.TESTNET, webAuthHost);
    const tx = verifySep10Challenge(xdr, tomlFor(server), client.publicKey());
    expect(tx.source).toBe(server.publicKey());
  });

  it("rejects a challenge from a different signing key", () => {
    const server = Keypair.random();
    const other = Keypair.random();
    const client = Keypair.random();
    const xdr = WebAuth.buildChallengeTx(server, client.publicKey(), homeDomain, 300, Networks.TESTNET, webAuthHost);
    expect(() => verifySep10Challenge(xdr, tomlFor(other), client.publicKey())).toThrow(Sep10Error);
  });

  it("rejects a challenge issued for another account", () => {
    const server = Keypair.random();
    const client = Keypair.random();
    const xdr = WebAuth.buildChallengeTx(server, client.publicKey(), homeDomain, 300, Networks.TESTNET, webAuthHost);
    expect(() => verifySep10Challenge(xdr, tomlFor(server), Keypair.random().publicKey())).toThrow(/different Stellar account/);
  });

  it("lets the client keypair sign the challenge XDR", () => {
    const server = Keypair.random();
    const client = Keypair.random();
    const xdr = WebAuth.buildChallengeTx(server, client.publicKey(), homeDomain, 300, Networks.TESTNET, webAuthHost);
    const signed = signChallengeXdr(xdr, client, Networks.TESTNET);
    const found = WebAuth.verifyChallengeTxSigners(
      signed,
      server.publicKey(),
      Networks.TESTNET,
      [client.publicKey()],
      homeDomain,
      webAuthHost,
    );
    expect(found).toContain(client.publicKey());
  });
});
