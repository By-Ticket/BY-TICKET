# Roadmap

## Build phases (MVP on testnet)

| # | Phase | Status |
|---|---|---|
| 1 | Scaffold, folder structure, env setup, README | ✅ done |
| 2 | Soroban contracts + tests + testnet deploy | ✅ done |
| 3 | Database schema (Supabase + RLS) + auth | ✅ done (migrations to be applied to the Supabase project) |
| 4 | Wallet connection (Freighter + custodial) + ticket purchase | ⏳ wallet login + checkout built; a buy needs test USDC from the token issuer |
| 5 | My Tickets, rotating signed QR, offline scanner check-in | ⬜ |
| 6 | Organizer dashboard (events, tiers, analytics, payouts, rules) | ⏳ create / complete / cancel / release / milestone + cash-out wired; analytics still later |
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
- SEP-24 Stellar Anchor is live (`Sep24RampAdapter`, `RAMP_PROVIDER=sep24`). SEP-12 KYC gates deposits
  and organizer cash-out. Remaining: a Zambian production anchor that lists our USDC and the MTN /
  Airtel / Zamtel rails (kept as provider metadata).
- On-ramp: customer pays fiat in the anchor widget → USDC lands → ticket minted.
- Off-ramp: organizer cash-out after `release_payout` via `/transactions/withdraw/interactive`.
- Reconciliation jobs, webhook signature verification, idempotent settlement.

### Secondary marketplace
- Organizer-controlled resale: price caps, royalties to organizer/artist, and primary-sale escrow are now
  enforced on-chain (`event_ticket` v2). List, quote (fee/royalty/seller), and `transfer_ticket` settlement
  are wired in the web app. Remaining: anti-scalping limits per account, and indexer support for
  `escrowed` / `released` / `refunded` / `royalty_paid`.

### Sponsor & vendor perks
- Vendors (food, drinks, merch) register perks redeemable with BY Points at the venue.
- Sponsor-funded point pools and campaigns ("attend 3 shows, get merch").
- Vendor scanner mode to redeem perks; settlement reports for vendors.

### Other
- USSD / SMS ticket delivery for feature phones; WhatsApp ticket sharing.
- Multi-language UI (English, Bemba, Nyanja, Tonga, Lozi).
- Native wrappers (TWA for Android) for better camera + offline storage.
- Organizer KYC and payouts compliance.
