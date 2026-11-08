import { describe, expect, it } from "vitest";
import { isStellarWalletEmail, stellarWalletEmail } from "./stellar-wallet";

describe("stellar wallet login email", () => {
  it("builds a never-deliverable address from the public key", () => {
    expect(stellarWalletEmail("GD465LGB26SQGE62M37VHUK6RBG63GS7TGTNPXXDGOJHSYRG7Y3LSGZF")).toBe(
      "gd465lgb26sqge62m37vhuk6rbg63gs7tgtnpxxdgojhsyrg7y3lsgzf@wallets.invalid",
    );
  });

  it("detects wallet-login emails and ignores real ones", () => {
    expect(isStellarWalletEmail("gd465lgb26sqge62m37vhuk6rbg63gs7tgtnpxxdgojhsyrg7y3lsgzf@wallets.invalid")).toBe(
      true,
    );
    expect(isStellarWalletEmail("alfredwalima@gmail.com")).toBe(false);
    expect(isStellarWalletEmail(null)).toBe(false);
  });
});
