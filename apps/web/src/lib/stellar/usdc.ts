/**
 * Circle's official Stellar USDC (classic issuer + SEP-41 SAC).
 * https://developers.stellar.org/docs/build/agentic-payments/x402
 * https://developers.circle.com/stablecoins/usdc-contract-addresses
 *
 * Mock USDC (`MOCK_USDC`) is only for local `USDC_MODE=mock` deploys and unit tests.
 * Production and hosted testnet use Circle; never fall back to the mock issuer.
 */
export const CIRCLE_USDC = {
  testnet: {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  },
  public: {
    code: "USDC",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  },
} as const;

/** Historical testnet mock from `USDC_MODE=mock`. Do not use on Vercel. */
export const MOCK_USDC = {
  code: "USDC",
  issuer: "GB4RGUGQOUHQXDYV4YJGKXYT7WF5HLCMBSSYDCWHFJ5QAOZ2KYYYXLHG",
  contractId: "CBM5X6RZPBJJYHGGGYMVCR2FDVEMNGCTP7NX6PFR2UBGB75FEFQJRVNL",
} as const;

export function circleUsdc(network: "testnet" | "public") {
  return CIRCLE_USDC[network];
}

/** Env overrides win (so local `.env.local` can still point at mock USDC). Otherwise Circle. */
export function resolvedUsdc(
  network: "testnet" | "public",
  issuer?: string,
  contractId?: string,
): { code: "USDC"; issuer: string; contractId: string } {
  const circle = circleUsdc(network);
  return {
    code: "USDC",
    issuer: issuer ?? circle.issuer,
    contractId: contractId ?? circle.contractId,
  };
}
