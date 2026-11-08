/** RFC 2606 reserved TLD — these addresses never receive mail. */
export const STELLAR_WALLET_EMAIL_DOMAIN = "wallets.invalid";

/** Auth user email for a Stellar-wallet login. Not shown to the user. */
export function stellarWalletEmail(publicKey: string): string {
  return `${publicKey.toLowerCase()}@${STELLAR_WALLET_EMAIL_DOMAIN}`;
}

export function isStellarWalletEmail(email: string | null | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith(`@${STELLAR_WALLET_EMAIL_DOMAIN}`));
}
