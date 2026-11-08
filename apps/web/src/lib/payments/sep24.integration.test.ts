import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { exchangeSep10Token, requestSep10Challenge, signChallengeXdr } from "./sep10";
import { fetchSep24Info } from "./sep24";
import { fetchStellarToml } from "./toml";

const HOME = "testanchor.stellar.org";

describe("testanchor.stellar.org", () => {
  it(
    "discovers SEP-10 and SEP-24 endpoints from stellar.toml",
    async () => {
      const toml = await fetchStellarToml(HOME);
      expect(toml.signingKey).toMatch(/^G[A-Z2-7]{55}$/);
      expect(toml.webAuthEndpoint).toMatch(/^https:\/\/testanchor\.stellar\.org\/auth/);
      expect(toml.transferServerSep24).toMatch(/^https:\/\/testanchor\.stellar\.org\/sep24/);
    },
    20_000,
  );

  it(
    "lists assets on /info and can complete SEP-10 with a random keypair",
    async () => {
      const toml = await fetchStellarToml(HOME);
      const info = await fetchSep24Info(toml);
      expect(info.deposit).toBeTypeOf("object");
      expect(Object.keys(info.deposit).length).toBeGreaterThan(0);

      const client = Keypair.random();
      const challenge = await requestSep10Challenge(toml, client.publicKey());
      const signed = signChallengeXdr(challenge.transaction, client, challenge.networkPassphrase);
      const token = await exchangeSep10Token(toml, signed, client.publicKey());
      expect(token.token.split(".")).toHaveLength(3);
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    },
    30_000,
  );
});
