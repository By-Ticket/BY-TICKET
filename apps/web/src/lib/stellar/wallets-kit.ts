"use client";

import { stellarConfig } from "./config";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

let started = false;
let kitPromise: Promise<Kit> | null = null;

async function loadKit(): Promise<Kit> {
  if (typeof window === "undefined") {
    throw new Error("Wallets can only be used in the browser.");
  }
  if (!kitPromise) {
    kitPromise = Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
      import("@creit.tech/stellar-wallets-kit/types"),
    ]).then(([{ StellarWalletsKit }, { defaultModules }, { Networks }]) => {
      if (!started) {
        StellarWalletsKit.init({
          modules: defaultModules(),
          network: stellarConfig.isTestnet ? Networks.TESTNET : Networks.PUBLIC,
          authModal: { showInstallLabel: true },
        });
        started = true;
      }
      return StellarWalletsKit;
    });
  }
  return kitPromise;
}

export function signatureToString(signed: unknown): string | null {
  if (typeof signed === "string" && signed.trim()) return signed;
  if (signed instanceof Uint8Array) return btoa(String.fromCharCode(...signed));
  return null;
}

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const record = err as { message?: unknown; error?: unknown };
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return "";
}

/** Null when the user closed the wallet modal or cancelled signing. */
export function walletUserMessage(err: unknown): string | null {
  const text = errorText(err).toLowerCase();
  if (!text) return "The wallet request didn't finish. Try another Stellar wallet.";
  if (/(cancel|abort|closed|rejected|denied|user declined)/.test(text)) return null;
  if (/network/.test(text)) {
    return `Switch the wallet to ${stellarConfig.isTestnet ? "Testnet" : "Mainnet"} and try again.`;
  }
  if (/not support|unsupported/.test(text)) {
    return "That wallet can't sign this request. Try Freighter, xBull, Albedo, LOBSTR, or Rabet.";
  }
  return "The wallet request didn't finish. Unlock it, approve the prompt, and try again.";
}

export async function pickStellarAddress(): Promise<string> {
  const Kit = await loadKit();
  const { address } = await Kit.authModal();
  if (!address) throw new Error("The wallet didn't share an address.");
  return address;
}

export async function signStellarMessage(message: string, address: string): Promise<string> {
  const Kit = await loadKit();
  const signed = await Kit.signMessage(message, {
    address,
    networkPassphrase: stellarConfig.networkPassphrase,
  });
  const signature = signatureToString(signed.signedMessage);
  if (!signature) throw new Error("The wallet didn't return a signature.");
  if (signed.signerAddress && signed.signerAddress !== address) {
    throw new Error("The wallet signed with a different account. Select the same account and try again.");
  }
  return signature;
}

export async function signStellarTransaction(xdr: string, address: string): Promise<string> {
  const Kit = await loadKit();
  try {
    const signed = await Kit.signTransaction(xdr, {
      address,
      networkPassphrase: stellarConfig.networkPassphrase,
    });
    if (!signed.signedTxXdr) throw new Error("The wallet didn't return a signed transaction.");
    return signed.signedTxXdr;
  } catch (err) {
    const text = errorText(err).toLowerCase();
    if (/(not connected|no wallet|selected wallet|getaddress)/.test(text)) {
      const picked = await pickStellarAddress();
      if (picked !== address) {
        throw new Error("Connect the same Stellar account that holds this ticket wallet.");
      }
      const signed = await Kit.signTransaction(xdr, {
        address,
        networkPassphrase: stellarConfig.networkPassphrase,
      });
      if (!signed.signedTxXdr) throw new Error("The wallet didn't return a signed transaction.");
      return signed.signedTxXdr;
    }
    throw err;
  }
}
