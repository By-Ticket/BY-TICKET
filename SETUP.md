# Run BY Tickets locally

The web app is a Next.js server. Off-chain data lives in Supabase (Postgres, Auth, Storage).
You do not need a hosted Supabase project to run it: the Supabase CLI starts a local stack.

## Prerequisites

- Node.js ≥ 20.9 (22 LTS matches `.nvmrc`)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.122 or newer (3.x is fine)
- Docker, **or** Linux / macOS Apple silicon with no container engine. With no Docker, CLI 3 uses its native process runtime automatically when `[experimental] stack` is enabled in `supabase/config.toml` (it is, in this repo).

Contracts (Rust / Stellar) are optional for the website and the database. They need Docker and `npm run contracts:*`. Stellar testnet keys are optional until you deploy contracts.

## 1. Install and create env

```bash
npm --prefix apps/web ci
npm run secrets
```

`npm run secrets` copies `apps/web/.env.example` to `apps/web/.env.local` (gitignored) and fills the generated keys:

| Variable | What |
|---|---|
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | AES-256-GCM key for email users' wallet secrets |
| `QR_CREDENTIAL_SIGNING_KEY` / `NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY` | Ed25519 pair for ticket QR credentials |
| `STELLAR_PLATFORM_SECRET` / `NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY` | Local platform account. `npm run secrets -- --fund` asks Stellar Friendbot to fund it on testnet |

## 2. Start the database

From the repo root:

```bash
supabase start --eager
```

The first run downloads the local stack. `--eager` starts every enabled service immediately and keeps them from shutting down when idle. Later starts reuse the same runtime (Docker if the daemon is up, otherwise native processes).

Default local endpoints (set in `supabase/config.toml`):

| Service | URL |
|---|---|
| API (PostgREST, Auth, Storage) | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | http://127.0.0.1:54323 |
| Mailpit (sign-in emails) | http://127.0.0.1:54324 |

The database password `postgres` is the local default only. Do not reuse it anywhere else.

Migrations in `supabase/migrations/` are applied on the first start. `supabase/seed.sql` adds one demo perk. Sign-in creates the real user, profile, and custodial wallet.

Copy the local API URL and keys into `apps/web/.env.local`. Nothing here is a production secret; still do not commit the file.

```bash
supabase status --env
```

Set:

| `.env.local` | From `supabase status --env` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` (the legacy `ANON_KEY` also works) |
| `SUPABASE_SECRET_KEY` | `SECRET_KEY` (the legacy `SERVICE_ROLE_KEY` also works) |

Optional: `ADMIN_EMAILS=you@example.com` grants that address the admin role on first sign-in.

Hosted Supabase instead of the local stack: create a project, run `supabase link` and `supabase db push` (or paste the migration files in order), then use that project's URL and keys. Auth URL setup is in [supabase/README.md](supabase/README.md).

## 3. Build and run the app

`NEXT_PUBLIC_*` values are inlined at build time, so set the Supabase URL and publishable key before building.

```bash
npm run build
npm run start
```

Dev server with reload: `npm run dev`.

Open http://localhost:3000. Database check: http://localhost:3000/api/health — `database.reachable` is true and `database.settings` is the number of `platform_settings` rows (3 after the migrations).

## 4. Sign in (proves a write)

1. Open http://localhost:3000/login and enter your email.
2. The page shows a 6-digit code. The local stack cannot put that code in Mailpit (custom mail templates are unsupported there). On a hosted project the code arrives by email instead. Mailpit at http://127.0.0.1:54324 still keeps a magic link, which only works in the same browser that asked for it.
3. Enter the code. The app writes a profile row, the `customer` role, and (when the encryption key is set) a custodial wallet.
4. Open http://localhost:3000/account, edit your name, and save. That updates `profiles`.
5. http://localhost:3000/organizer submits an organizer application (`organizers` insert).

## Stop

```bash
supabase stop
```

`supabase stop` keeps the data. A later `supabase start --eager` brings the same database back.

## What you still have to provide

| Need | Local substitute | You provide |
|---|---|---|
| Database, Auth, Storage | `supabase start` | A Supabase project URL, publishable key, and secret key |
| Sign-in email delivery | Mailpit | Custom SMTP in the Supabase project (the built-in mailer is rate-limited) |
| Stellar platform account | Generated test key, unfunded until `--fund` | A funded account. On mainnet use a KMS, not `STELLAR_PLATFORM_SECRET` |
| Contract IDs | Empty; the app boots without them | `npm run contracts:deploy` (Docker + testnet) writes them into `.env.local` |
| Mobile-money ramp | `PAYMENT_RAMP_PROVIDER=stub` | A real provider and its credentials (not implemented) |
| Redis rate limit | In-memory fallback | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` if you want a shared limiter |

## Permanent free deploy

The site is one Next.js server (pages, server actions, and `/api`). It is not a static frontend plus a separate API.

Use **Render** (free web service, [`render.yaml`](render.yaml)) or **Netlify** (Next.js runtime, [`netlify.toml`](netlify.toml)) for that server. Use **Supabase** for Postgres, Auth, and Storage. The app talks to Supabase's API (`@supabase/ssr`), so a plain Postgres host such as Neon does not replace it.

Cloudflare Pages is not set up. Pages serves static files and edge functions. This app's sign-in, account, and database calls run in the Node server. Putting it on Pages would need an untested adapter.

Free-tier limits to expect: a Render free web service spins down after about 15 minutes without traffic and wakes on the next request. A Supabase free project can pause after inactivity; resume it in the Supabase dashboard.

### 1. Create the Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply `supabase/migrations` in filename order. From a machine with the CLI: `supabase link --project-ref <ref>` then `supabase db push`. Or paste each file into the SQL editor, oldest first.
3. Authentication → URL configuration:
   - Site URL = the public app URL from step 2 (you can start with `http://localhost:3000` and change it after the first deploy).
   - Redirect URLs: `https://<your-host>/auth/callback` and `https://<your-host>/auth/confirm`.
4. Emails → Magic Link: include `{{ .Token }}` and a link to `/auth/confirm?token_hash={{ .TokenHash }}&type=email`, as in [supabase/README.md](supabase/README.md). Add custom SMTP before real use.
5. Project Settings → API Keys. Copy the project URL, the publishable (or anon) key, and the secret (or service_role) key.

### 2. Deploy the Next.js app

Production (Vercel) env vars and the Supabase migration order: [docs/DEPLOY.md](docs/DEPLOY.md).

Generate secrets once on your machine (`npm run secrets`) and paste them into the host. Do not commit them. Set `NEXT_PUBLIC_*` before the first production build. Changing them later requires a new deploy.

**Render (matches `render.yaml`):**

1. Render dashboard → New → Blueprint → connect this repo. Render reads `render.yaml`.
2. When it asks, fill every variable marked `sync: false`. The required ones are listed below.
3. Deploy. The service builds `apps/web` with `npm ci && npm run build` and starts `next start` on `$PORT`.
4. Copy the `https://<name>.onrender.com` URL into `NEXT_PUBLIC_APP_URL` and redeploy.
5. Add that origin's `/auth/callback` and `/auth/confirm` to the Supabase redirect allow list, and set the Site URL to the same origin.

**Netlify (matches `netlify.toml`):**

1. New site from Git. The toml sets the base directory to `apps/web`, Node 22, and `npm run build`. Leave the publish directory empty so the Next.js runtime can own it.
2. Site configuration → Environment variables. Add the variables below. Netlify bakes `NEXT_PUBLIC_*` into the build.
3. Deploy, then set `NEXT_PUBLIC_APP_URL` to the `https://<name>.netlify.app` URL and redeploy.
4. Update the Supabase Site URL and redirect allow list to that origin, same as Render.

### Environment variables

| Variable | Required on the host | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Yes | Public `https` origin. No trailing slash. Redeploy after you know the URL. |
| `NEXT_PUBLIC_APP_NAME` | No | Defaults to `BY Tickets`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable or legacy anon key. Public in the browser. |
| `SUPABASE_SECRET_KEY` | Yes | Secret or service_role key. Server only. Bypasses RLS. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `testnet` (default) or `public`. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | No | Default testnet RPC is in `.env.example`. |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | No | Default testnet Horizon is in `.env.example`. |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | No | Default is the testnet passphrase. |
| `NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID` | Yes on host | Testnet v2: `CBBZ2U62CAXXZAKROVI7YFELJXILLZDNICL6SL3PUEIX4AEEGYHDSFQD`. |
| `NEXT_PUBLIC_REWARDS_CONTRACT_ID` | Yes on host | Testnet v2: `CB3XCW3EZQNIKHYYDYYG5WXQA3BJZK7RIHXFX2LIXHV775YE5STG3B3C`. |
| `NEXT_PUBLIC_BADGE_CONTRACT_ID` | Yes on host | Testnet v2: `CCHNNBCK5UKWSYGK4JPPBBWW6YCIRTTDGMD7LTRZXB74JZAHF4C5E3AT`. |
| `NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY` | No | Public key only. |
| `NEXT_PUBLIC_USDC_ASSET_CODE` | No | Default `USDC`. |
| `NEXT_PUBLIC_USDC_ISSUER` | Yes on host | Circle testnet `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; mainnet `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`. |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | Yes on host | Circle testnet SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. |
| `STELLAR_PLATFORM_SECRET` | For chain writes | `S...` seed. Server only. Generate with `npm run secrets`. |
| `NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY` | For chain writes | Matching `G...` public key. |
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | For email sign-in wallets | 32-byte base64 key from `npm run secrets`. Server only. |
| `QR_CREDENTIAL_SIGNING_KEY` | For ticket QR | 32-byte base64url seed. Server only. |
| `NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY` | For ticket QR | Matching public key. |
| `NEXT_PUBLIC_QR_ROTATION_SECONDS` | No | Default `20`. |
| `NEXT_PUBLIC_ZMW_PER_USDC` | No | Default `26.5`. |
| `PLATFORM_FEE_BPS` | No | Default `250`. |
| `RAMP_PROVIDER` | `sep24` on host | Code/tests default `stub`. `PAYMENT_RAMP_PROVIDER` is a deprecated alias. |
| `ANCHOR_HOME_DOMAIN` | For `sep24` | Host only. Defaults to `testanchor.stellar.org` on testnet. |
| `KYC_THRESHOLD_AMOUNT` | No | USDC amount below which fan deposits may skip KYC. Default `0`. |
| `ANCHOR_CALLBACK_SECRET` | For live KYC callbacks | Shared secret or HMAC key. Server only. |
| `UPSTASH_REDIS_REST_URL` | No | Empty uses the in-memory limiter. |
| `UPSTASH_REDIS_REST_TOKEN` | No | Pair with the URL. |
| `ADMIN_EMAILS` | No | Comma-separated. Those addresses become admins on first sign-in. |

After deploy, open `https://<your-host>/api/health`. `database.reachable` should be `true` and `database.settings` should be `3`.
