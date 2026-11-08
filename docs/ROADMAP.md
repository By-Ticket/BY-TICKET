# Roadmap

## Build phases (MVP on testnet)

| # | Phase | Status |
|---|---|---|
| 1 | Scaffold, folder structure, env setup, README | ✅ done |
| 2 | Soroban contracts + tests + testnet deploy | ✅ done |
| 3 | Database schema (Supabase + RLS) + auth | ✅ done (migrations to be applied to the Supabase project) |
| 4 | Wallet connection (Freighter + custodial) + ticket purchase | ⏳ wallet login + checkout built; a buy needs test USDC from the token issuer |
| 5 | My Tickets, rotating signed QR, offline scanner check-in | ⬜ |
| 6 | Organizer dashboard (events, tiers, analytics, payouts, rules) | ⬜ |
| 7 | Rewards (BY Points) + proof-of-attendance badges | ⬜ |
| 8 | Polish: mobile UX, brand, empty/error/loading states, seed data | ⬜ |

## After the MVP

### Mainnet launch
- Security audit of the three contracts; freeze interfaces, enable an upgrade path behind admin multisig.
- Move platform/admin keys to a KMS/HSM (AWS KMS, GCP KMS or HashiCorp Vault) and multisig (Stellar
  native thresholds) for the admin account; key rotation runbook.
- Switch `NEXT_PUBLIC_STELLAR_NETWORK=public`, mainnet RPC provider with SLA, Circle mainnet USDC.
- Monitoring: contract event indexer health, failed-tx alerts, fee-sponsor balance alerts.
- Legal: terms, refund policy, data protection (Zambia Data Protection Act 2021).

### Mobile money on/off-ramp
- Implement `PaymentRampAdapter` for MTN MoMo, Airtel Money, Zamtel Kwacha (directly or via an aggregator).
- On-ramp: customer pays ZMW via USSD/STK push → anchor/partner credits USDC → ticket minted.
- Off-ramp: organizer payouts in ZMW via SEP-24/SEP-31 anchors.
- Reconciliation jobs, webhook signature verification, idempotent settlement.

### Secondary marketplace
- Organizer-controlled resale: price caps (already enforced on-chain), royalties to organizer/artist on
  each resale, escrowed USDC settlement, anti-scalping limits per account.

### Sponsor & vendor perks
- Vendors (food, drinks, merch) register perks redeemable with BY Points at the venue.
- Sponsor-funded point pools and campaigns ("attend 3 shows, get merch").
- Vendor scanner mode to redeem perks; settlement reports for vendors.

### Other
- USSD / SMS ticket delivery for feature phones; WhatsApp ticket sharing.
- Multi-language UI (English, Bemba, Nyanja, Tonga, Lozi).
- Native wrappers (TWA for Android) for better camera + offline storage.
- Organizer KYC and payouts compliance.
