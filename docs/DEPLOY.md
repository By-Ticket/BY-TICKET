# Production deploy checklist

Hosted web is Vercel (team `by-ticket`, project `by-ticket`). Database is hosted
Supabase. Contracts live on Stellar. `NEXT_PUBLIC_*` values are baked in at **build**
time — change them, then redeploy.

Full variable notes: [`apps/web/.env.example`](../apps/web/.env.example), [SETUP.md](../SETUP.md).
Circle USDC issuers: [`contracts/deployments/circle-usdc.json`](../contracts/deployments/circle-usdc.json).

## 1. Supabase migrations (apply in this order)

Apply every file in `supabase/migrations/` that is not already on the project
(`supabase db push`, the SQL editor, or the Supabase MCP `apply_migration`).
Do not skip or reorder.

1. `20261001000100_core_schema.sql` — tables, enums, token types
2. `20261001000200_auth_and_rls.sql` — RLS policies
3. `20261001000300_rpc.sql` — `my_organizer`, `admin_*` RPCs
4. `20261001000400_storage.sql` — media buckets
5. `20261026000500_private_helpers.sql` — policy helpers moved to `private`
6. `20261029000100_wallet_login_challenges.sql` — Freighter login challenges
7. `20261108144750_ramp_transactions.sql` — SEP-24 `ramp_transactions`
8. `20261108153000_kyc_customers.sql` — SEP-12 `kyc_customers`
9. `20261108200000_event_payouts_listings.sql` — `event_payouts`, `ticket_listings`, `royalty_bps`

Then in Supabase Auth: Site URL = `https://by-ticket.vercel.app` (or the custom
domain). Redirect allow list must include `/auth/callback` and `/auth/confirm` on
that origin.

## 2. Vercel environment variables

Set these on the Vercel project for **Production** (and Preview if you want
preview deploys to hit the same stack). Secrets stay **Sensitive**; `NEXT_PUBLIC_*`
are inlined into the browser bundle — never put seeds or callback secrets there.

### App and database

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://by-ticket.vercel.app` (no trailing slash) |
| `NEXT_PUBLIC_APP_NAME` | `BY Tickets` |
| `NEXT_PUBLIC_SUPABASE_URL` | Hosted project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (or legacy anon) key |
| `SUPABASE_SECRET_KEY` | Secret (or service_role) key. Server only |

### Stellar network and v2 contracts

| Variable | Production (testnet) | Mainnet (`public`) |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | `public` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Mainnet RPC with SLA |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID` | `CBBZ2U62CAXXZAKROVI7YFELJXILLZDNICL6SL3PUEIX4AEEGYHDSFQD` | New deploy |
| `NEXT_PUBLIC_REWARDS_CONTRACT_ID` | `CB3XCW3EZQNIKHYYDYYG5WXQA3BJZK7RIHXFX2LIXHV775YE5STG3B3C` | New deploy |
| `NEXT_PUBLIC_BADGE_CONTRACT_ID` | `CCHNNBCK5UKWSYGK4JPPBBWW6YCIRTTDGMD7LTRZXB74JZAHF4C5E3AT` | New deploy |
| `NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY` | Contract admin `G…` (public only) | Multisig admin |

The current testnet `event_ticket` was initialized with a mock USDC SAC. To settle
in Circle USDC, redeploy with `USDC_MODE=circle` (the deploy-script default) and
replace the three contract IDs above with the new ones.

### Circle USDC (not mock)

| Variable | Testnet | Mainnet |
|---|---|---|
| `NEXT_PUBLIC_USDC_ASSET_CODE` | `USDC` | `USDC` |
| `NEXT_PUBLIC_USDC_ISSUER` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| `NEXT_PUBLIC_USDC_CONTRACT_ID` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

Do **not** set the mock issuer `GB4RGUGQOUHQXDYV4YJGKXYT7WF5HLCMBSSYDCWHFJ5QAOZ2KYYYXLHG` on Vercel.
Mock USDC is only for local `USDC_MODE=mock` and unit tests.

### Platform, custodial, QR

| Variable | Notes |
|---|---|
| `STELLAR_PLATFORM_SECRET` | `S…` seed. Server only. Prefer KMS on mainnet |
| `NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY` | Matching `G…` |
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | 32-byte base64 from `npm run secrets` |
| `QR_CREDENTIAL_SIGNING_KEY` | 32-byte base64url seed. Server only |
| `NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY` | Matching public key |
| `NEXT_PUBLIC_QR_ROTATION_SECONDS` | Optional. Default `20` |
| `NEXT_PUBLIC_ZMW_PER_USDC` | Optional. Default `26.5` |
| `PLATFORM_FEE_BPS` | Optional. Default `250` |
| `ADMIN_EMAILS` | Optional. Comma-separated, become admin on first sign-in |

### SEP-24 / SEP-12 (production)

| Variable | Production value |
|---|---|
| `RAMP_PROVIDER` | `sep24` |
| `ANCHOR_HOME_DOMAIN` | Anchor host only, no scheme (testnet default `testanchor.stellar.org`) |
| `ANCHOR_CALLBACK_SECRET` | Shared secret or HMAC key. Server only. Min 16 characters |
| `KYC_THRESHOLD_AMOUNT` | Optional. Default `0` |

Local and CI keep `RAMP_PROVIDER=stub` so checkout tests auto-approve.

### Optional

| Variable | Notes |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Empty = in-memory rate limit |
| `UPSTASH_REDIS_REST_TOKEN` | Pair with the URL |
| `PAYMENT_RAMP_PROVIDER` | Deprecated alias of `RAMP_PROVIDER` |

## 3. After env is set

1. Redeploy the Vercel production build so `NEXT_PUBLIC_*` is inlined.
2. Open `https://<host>/api/health`. `database.reachable` should be true.
3. Confirm a Freighter or custodial wallet can add a **Circle** USDC trustline and that
   SEP-24 `GET /info` lists that issuer.
