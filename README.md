# BY Tickets

**Buy. Attend. Earn. Connect.**

Blockchain-powered event ticketing and rewards on the [Stellar](https://stellar.org) network, built for small
organizers, artists, promoters, venues and community events in Zambia and across Africa. Mobile-first PWA,
friendly to low-bandwidth connections.

- **Organizers** list events, sell tickets, set transfer/resale rules, hold proceeds in escrow until the event
  completes, split revenue (including resale royalties), scan at the door.
- **Customers** discover events, buy with a Stellar wallet *or* just an email, earn BY Points, collect badges.
- **Tickets** are verifiable on-chain; check-in is single-use; QR codes rotate and can't be screenshotted.

> Status: **Phase 3 of 8 complete**: contracts are live on Stellar testnet; the database schema with RLS and email
> sign-in is built and tested. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

| Layer | Tech |
|---|---|
| Web | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Base UI) · PWA |
| Backend | Next.js Route Handlers / Server Actions · Supabase (Postgres + RLS, Auth, Storage) · zod |
| Chain | Stellar testnet · Soroban contracts in Rust (`soroban-sdk` 28) · `@stellar/stellar-sdk` · Freighter |
| Payments | USDC / XLM on Stellar · ZMW display pricing · mobile-money adapter interface (stub) |

## Repository layout

```
.
├── apps/web/                 Next.js PWA (customer, organizer, scanner, admin, /api)
│   ├── .env.example          environment template (copy to apps/web/.env.local)
│   └── src/
│       ├── app/              routes + api/health
│       ├── components/       ui/ (shadcn), layout/, brand/
│       └── lib/              env, stellar/, supabase/, payments/, security/
├── contracts/                Soroban Cargo workspace (host Rust + Stellar CLI)
│   ├── Dockerfile            unused; do not build contracts in Docker
│   ├── event_ticket/         events, tickets, escrow payouts, refunds, resale royalties, check-in
│   ├── rewards/              BY Points (SEP-41 token) + perks
│   ├── attendance_badge/     proof-of-attendance badges
│   └── deployments/          testnet.json (deployed contract IDs + wasm hashes)
├── supabase/                 migrations/ (schema, RLS, RPCs, storage), tests/ (RLS suite), seed.sql
├── scripts/                  contracts.ps1, gen-secrets.mjs, deploy-testnet.sh, smoke-testnet.sh
├── docker-compose.yml        unused; do not use Docker in this project
└── docs/                     ARCHITECTURE · CONTRACTS · API · SECURITY · DECISIONS · ROADMAP
```

## Prerequisites

- **Node.js ≥ 20.9** (22 LTS recommended)
- **Rust ≥ 1.91** with the MSVC host and the `wasm32v1-none` target, plus the **Windows SDK** (the linker needs
  `kernel32.lib`). **Stellar CLI 28.1.0** on `PATH` or in `%USERPROFILE%\.local\bin`. **Git for Windows** for
  deploy and smoke. See DECISIONS D-034. Do not use Docker for contracts.
- The **Supabase CLI** (2.122+) for a local database, or a hosted Supabase project. See [SETUP.md](SETUP.md).
- **Freighter** or another recognized Stellar wallet, set to *Testnet*, for wallet testing

## Quick start

```bash
# 1. install web deps and create apps/web/.env.local with generated secrets
npm run setup

# 2. (optional) fund the platform account on testnet via Friendbot
npm run secrets -- --fund

# 3. contracts (host Rust + Stellar CLI — no Docker)
npm run contracts:doctor
npm run contracts:test
npm run contracts:deploy   # writes contract IDs into apps/web/.env.local
npm run contracts:smoke    # optional: live end-to-end purchase → check-in on testnet

# 4. database (local Supabase: migrations + seed). Full steps: SETUP.md
supabase start --eager
supabase status --env   # copy API_URL, PUBLISHABLE_KEY, SECRET_KEY into apps/web/.env.local

# 5. run the app
npm run build && npm run start     # http://localhost:3000
# or: npm run dev
# health check: http://localhost:3000/api/health
#   database.reachable true means the app read platform_settings
```

`npm run setup` copies `apps/web/.env.example` to `apps/web/.env.local` and fills in:

| Variable | What |
|---|---|
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | AES-256-GCM key for email users' wallet secrets |
| `QR_CREDENTIAL_SIGNING_KEY` / `NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY` | Ed25519 pair for signed ticket QR credentials |
| `STELLAR_PLATFORM_SECRET` / `NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY` | testnet platform account (fee sponsor, platform fee receiver) |

You then add the Supabase URL + keys from `supabase status --env` (local) or from a hosted project.
Step-by-step local run, including every env var: [SETUP.md](SETUP.md).
Hosted auth URL and email-template setup: [supabase/README.md](supabase/README.md).
Every variable is documented in [`apps/web/.env.example`](apps/web/.env.example) and validated with zod at startup.

## Scripts (repo root)

| Command | Does |
|---|---|
| `npm run setup` | install web deps + generate secrets |
| `npm run secrets [-- --fund \| --force]` | (re)generate missing secrets; `--fund` uses testnet Friendbot |
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run typecheck` / `lint` | TypeScript + ESLint |
| `npm test` | web unit tests (Vitest): key encryption, redirects, validation |
| `npm run db:test` | not run locally; migrations are applied through Supabase |
| `npm run db:types` | regenerate `database.types.ts` from the migrations |
| `npm run contracts:doctor` | print `rustc`, `cargo`, and `stellar` versions |
| `npm run contracts:test` | `cargo test` for all contracts |
| `npm run contracts:lint` | `cargo fmt --check` + `clippy -D warnings` |
| `npm run contracts:build` | `stellar contract build` → WASM |
| `npm run contracts:deploy` | deploy to testnet, write IDs to `apps/web/.env.local` + `contracts/deployments/testnet.json` |
| `npm run contracts:smoke` | live testnet end-to-end check (buy, split, check-in, replay rejected, points, badge) |
| `npm run check` | typecheck + lint + unit tests + contract tests |

## Deploy

- **Contracts → testnet:** `npm run contracts:deploy`. Default settlement is Circle's official
  testnet USDC. The script deploys `rewards`, `attendance_badge` and `event_ticket` against that SAC,
  then writes IDs into `apps/web/.env.local`. Safe to re-run (fresh instances). Local/tests only:
  `USDC_MODE=mock`. Options: `FEE_BPS=250`, `ORGANIZER=G…`.
  Full interface: [docs/CONTRACTS.md](docs/CONTRACTS.md).
- **Database:** apply `supabase/migrations` in the order listed in [docs/DEPLOY.md](docs/DEPLOY.md)
  (Supabase MCP, `supabase db push`, or the SQL editor) and configure Auth as described in
  [supabase/README.md](supabase/README.md).
- **Web:** Vercel ([`vercel.json`](vercel.json) — Next.js service `web` at `apps/web`). Production
  env vars and the migration checklist: [docs/DEPLOY.md](docs/DEPLOY.md). `NEXT_PUBLIC_*` values are
  baked in at build time, so redeploy after changing them. Render / Netlify notes: [SETUP.md](SETUP.md).

## Security

Keys and secrets are never committed and never put in `NEXT_PUBLIC_*` variables. Deployer, USDC-issuer, and
smoke-test keys are Stellar CLI identities in the local keystore, not in `.env` or the repo. The original
testnet admin was created in a Docker keystore this project no longer uses, so it is not available here.
See [docs/SECURITY.md](docs/SECURITY.md).

## Notes for this machine

This repo currently sits in a **OneDrive-synced folder**. That works, but `node_modules`, `.next` and
`contracts/target` make sync slow and can cause file-lock errors. Prefer moving the repo outside OneDrive
(e.g. `C:\dev\by-tickets`) or excluding those folders from sync.

On this PC the MSVC linker and Stellar CLI 28.1.0 are installed. Windows Application Control (os error 4551)
still blocks Cargo from running the unsigned build scripts it compiles, so `npm run contracts:test` and
`npm run contracts:build` stop there until that policy allows them. Run the command in your own terminal to
confirm. Smart App Control is the usual cause (Windows Security → App & browser control). Turning it off is
permanent until Windows is reinstalled.

## Docs

- [Architecture (mermaid diagrams)](docs/ARCHITECTURE.md)
- [Contract specs](docs/CONTRACTS.md)
- [API reference](docs/API.md)
- [Security & key handling](docs/SECURITY.md)
- [Decisions & assumptions](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)
