import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { serverEnv } from "@/lib/env.server";
import { stellarConfig } from "./config";
import type { ChainConfig } from "./chain";

export function chainConfig(): ChainConfig {
  const ticketContractId = stellarConfig.contracts.eventTicket;
  const usdcContractId = stellarConfig.usdc.contractId;
  const usdcIssuer = stellarConfig.usdc.issuer;
  if (!ticketContractId || !usdcContractId || !usdcIssuer) {
    throw new Error("Stellar contracts are not configured");
  }
  return {
    rpcUrl: stellarConfig.rpcUrl,
    horizonUrl: stellarConfig.horizonUrl,
    networkPassphrase: stellarConfig.networkPassphrase,
    ticketContractId,
    usdcContractId,
    usdcCode: stellarConfig.usdc.code,
    usdcIssuer,
    isTestnet: stellarConfig.isTestnet,
  };
}

export function platformKeypair(): Keypair {
  const secret = serverEnv.STELLAR_PLATFORM_SECRET;
  if (!secret) throw new Error("STELLAR_PLATFORM_SECRET is not set");
  return Keypair.fromSecret(secret);
}
