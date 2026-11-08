# BY Tickets

**Buy. Attend. Earn. Connect.**

Blockchain-powered event ticketing and rewards on the [Stellar](https://stellar.org) network, built for small
organizers, artists, promoters, venues and community events in Zambia and across Africa. Mobile-first PWA,
friendly to low-bandwidth connections.

- **Organizers** list events, sell tickets, set transfer/resale rules, split revenue, scan at the door.
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
├── contracts/                Soroban Cargo workspace (built and tested in Docker)
│   ├── Dockerfile            Rust 1.92 + wasm32v1-none + Stellar CLI 28.1
│   ├── event_ticket/         events, tiers, tickets, transfers, check-in, revenue split
│   ├── rewards/              BY Points (SEP-41 token) + perks
│   ├── attendance_badge/     proof-of-attendance badges
│   └── deployments/          testnet.json (deployed contract IDs + wasm hashes)
├── supabase/                 migrations/ (schema, RLS, RPCs, storage), tests/ (RLS suite), seed.sql
├── scripts/                  gen-secrets.mjs, deploy-testnet.sh, smoke-testnet.sh
├── docker-compose.yml        `soroban` toolchain service
└── docs/                     ARCHITECTURE · CONTRACTS · API · SECURITY · DECISIONS · ROADMAP
```

## Prerequisites

- **Node.js ≥ 20.9** (22 LTS recommended)
- **Docker Desktop** for contracts: Rust, the WASM target and the Stellar CLI all live in the `soroban` image,
  so you don't install them locally. (Native Rust also works if you prefer: Rust ≥ 1.91, `wasm32v1-none`,
  Stellar CLI 28; see DECISIONS D-014 for the Windows caveats.)
- The **Supabase CLI** (2.122+) for a local database. Docker is optional: without it the CLI runs Postgres, Auth, and the API as local processes. A hosted Supabase project works too. See [SETUP.md](SETUP.md).
- **Freighter** browser extension, set to *Testnet*, for wallet testing

## Quick start

```bash
# 1. install web deps and create apps/web/.env.local with generated secrets
npm run setup

# 2. (optional) fund the platform account on testnet via Friendbot
npm run secrets -- --fund

# 3. contracts (Docker): build the toolchain image once, test, deploy to testnet
npm run contracts:image
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
| `npm run db:test` | apply all migrations to a throwaway Postgres (Docker) and run the RLS test suite |
| `npm run db:types` | regenerate `database.types.ts` from the migrations |
| `npm run contracts:image` | build the `soroban` Docker toolchain image |
| `npm run contracts:test` | `cargo test` for all contracts (in Docker) |
| `npm run contracts:lint` | `cargo fmt --check` + `clippy -D warnings` |
| `npm run contracts:build` | `stellar contract build` → WASM |
| `npm run contracts:deploy` | deploy to testnet, write IDs to `apps/web/.env.local` + `contracts/deployments/testnet.json` |
| `npm run contracts:smoke` | live testnet end-to-end check (buy, split, check-in, replay rejected, points, badge) |
| `npm run contracts:shell` | shell inside the toolchain container (`stellar …`, `cargo …`) |
| `npm run check` | typecheck + lint + unit tests + contract tests + RLS tests |

## Deploy

- **Contracts → testnet:** `npm run contracts:deploy`. The script creates and funds a `by-deployer` CLI identity
  (it becomes the contract admin), builds the WASM, deploys a mock `USDC` asset contract, `rewards`,
  `attendance_badge` and `event_ticket`, registers `event_ticket` as minter, adds the treasury's USDC
  trustline, then writes the IDs into `apps/web/.env.local`. It's safe to re-run: each run deploys fresh
  instances. Options: `USDC_MODE=circle`, `FEE_BPS=250`, `ORGANIZER=G…`
  (e.g. `docker compose run --rm -e ORGANIZER=G... soroban bash /work/scripts/deploy-testnet.sh`).
  Full interface: [docs/CONTRACTS.md](docs/CONTRACTS.md).
- **Database:** apply `supabase/migrations` in order (Supabase MCP, `supabase db push`, or the SQL editor) and
  configure Auth as described in [supabase/README.md](supabase/README.md).
- **Web:** Render free web service ([`render.yaml`](render.yaml)) or Netlify's Next.js runtime
  ([`netlify.toml`](netlify.toml)). The app is one Node server, so Cloudflare Pages is not the target.
  Database is hosted Supabase (Auth + RLS + Storage), not a bare Postgres URL. Exact steps and every
  env var: [SETUP.md](SETUP.md). `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## Security

Keys and secrets are never committed and never put in `NEXT_PUBLIC_*` variables. Deployer/admin, USDC-issuer and
smoke-test keys live in the Stellar CLI keystore inside the `by-stellar-config` Docker volume, not in `.env` or
the repo. Removing that volume (`docker volume rm`) loses the testnet admin key, so you'd have to redeploy.
See [docs/SECURITY.md](docs/SECURITY.md).

## Notes for this machine

This repo currently sits in a **OneDrive-synced folder**. That works, but `node_modules`, `.next` and
`contracts/target` make sync slow and can cause file-lock errors. Prefer moving the repo outside OneDrive
(e.g. `C:\dev\by-tickets`) or excluding those folders from sync.

## Docs

- [Architecture (mermaid diagrams)](docs/ARCHITECTURE.md)
- [Contract specs](docs/CONTRACTS.md)
- [API reference](docs/API.md)
- [Security & key handling](docs/SECURITY.md)
- [Decisions & assumptions](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)
