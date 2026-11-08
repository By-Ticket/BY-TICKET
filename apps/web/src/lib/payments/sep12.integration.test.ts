import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { exchangeSep10Token, requestSep10Challenge, signChallengeXdr } from "./sep10";
import { Sep12Client } from "./sep12";
import { fetchStellarToml } from "./toml";

const HOME = "testanchor.stellar.org";

describe("testanchor.stellar.org SEP-12", () => {
  it(
    "discovers KYC_SERVER and returns a customer status after SEP-10",
    async () => {
      const toml = await fetchStellarToml(HOME);
      expect(toml.kycServer).toMatch(/testanchor\.stellar\.org/);
      const clientKp = Keypair.random();
      const challenge = await requestSep10Challenge(toml, clientKp.publicKey());
      const signed = signChallengeXdr(challenge.transaction, clientKp, challenge.networkPassphrase);
      const token = await exchangeSep10Token(toml, signed, clientKp.publicKey());
      const customer = await new Sep12Client(toml, token.token).getCustomer(clientKp.publicKey());
      expect(["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"]).toContain(customer.status);
    },
    30_000,
  );
});
