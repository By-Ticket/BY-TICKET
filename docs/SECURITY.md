# Security & Key Handling

## Secrets inventory

| Secret | Where it lives | Used by | Rotation |
|---|---|---|---|
| `SUPABASE_SECRET_KEY` | server env only | admin DB tasks, indexer | Supabase dashboard → API keys |
| `STELLAR_PLATFORM_SECRET` | server env only (testnet); KMS on mainnet | fee sponsorship, custodial account creation | new keypair → update signer on platform account |
| `CUSTODIAL_KEY_ENCRYPTION_KEY` | server env only; KMS on mainnet | AES-256-GCM encryption of custodial wallet secrets | key version prefix on ciphertext; re-encrypt job |
| `QR_CREDENTIAL_SIGNING_KEY` | server env only | signs ticket credentials | publish new public key; scanners accept old+new during overlap |
| Contract deployer / admin | Stellar CLI identity `by-deployer` in the local keystore, **not** in `.env` or the repo. The original testnet admin and `by-usdc-issuer` were created in the unused Docker keystore and are not held by the app | deploy + admin calls | transfer admin role to a multisig account before mainnet |

Rules:
1. **Never** put a secret in a `NEXT_PUBLIC_*` variable — those are inlined into browser JS.
2. `.env.local` is git-ignored; only `.env.example` (no real values) is committed.
3. Plaintext private keys never touch the database or logs. Custodial secrets are AES-256-GCM encrypted
   (random 96-bit IV, 128-bit tag, the wallet's public key as associated data, so a ciphertext copied onto another
   wallet row won't decrypt). They are stored in `custodial_keys` (`ciphertext`, `iv`, `auth_tag`, `key_version`),
   a table only the service role can read, and decrypted in memory only for the duration of a signature.
4. Env is validated with zod: `apps/web/src/lib/env.ts` (public values) and `apps/web/src/lib/env.server.ts`
   (secrets, guarded by `server-only`, so importing it from a Client Component fails the build).
5. Generate local secrets with `npm run secrets` (uses Node `crypto`; nothing leaves your machine).

## Authentication

- Email one-time code / magic link via Supabase Auth: no passwords to leak or reuse. Sessions are HTTP-only
  cookies managed by `@supabase/ssr`.
- `src/proxy.ts` refreshes the session and redirects signed-out visitors away from protected sections. That is
  an optimistic check only: every protected page and Server Action calls `requireViewer` / `requireRole`,
  which verifies the JWT with `auth.getClaims()`. The database enforces the same rules again through RLS.
- Post-login redirects go through `safeNextPath` (same-origin paths only: no open redirects), and auth callbacks
  redirect to `NEXT_PUBLIC_APP_URL`, never to the request's `Host` header.
- Rate limits: OTP send 5 per email and 15 per IP every 15 min; OTP verify 8 per email every 15 min. Supabase
  Auth's own limits also apply.
- Admins are bootstrapped from `ADMIN_EMAILS` on sign-in (service role). After that, roles change only through
  the `admin_set_role` / `admin_review_organizer` RPCs, which re-check the caller's admin role in the database
  and write to `audit_log`. An admin can't remove their own admin role.

## Database access model (Supabase)

| Layer | Rule |
|---|---|
| Table privileges | Supabase's default `GRANT ALL` to `anon` / `authenticated` is revoked; each table grants back only the needed operations, with **column lists** where part of a row is private (organizer contact details) or chain-controlled (`chain_event_id`, `status`) |
| Row-level security | enabled on every table; secrets tables (`custodial_keys`, `wallet_challenges`, `idempotency_keys`, `chain_cursors`) have no policies, so only the service role can reach them |
| Chain mirrors | `orders`, `tickets`, `ticket_transfers`, `checkins`, `points_ledger`, `badges`, `redemptions`, `ramp_transactions`, `kyc_customers` have **no write grants** for users. Only server code that verified the Stellar transaction (or the anchor poll / callback) writes them |
| SEP-10 JWT | stored in the `by_sep10` httpOnly cookie for the current session only. Never written to `localStorage` or a public table |
| KYC documents | identity files are POSTed to the anchor only. `kyc_customers` stores status and required field names, never document bytes. Callbacks require `ANCHOR_CALLBACK_SECRET` |
| Locked after publish | triggers block user edits to capacity, transfer rules, splits, start time and tier prices once an event is on-chain; changes go through the server, which updates the contract first |
| Integrity | unique `chain_*_id` and `tx_hash` columns make indexing idempotent; one accepted check-in per ticket; one order per `(user, idempotency_key)`; publish requires an on-chain event id |
| Helpers | `SECURITY DEFINER` functions with `search_path = ''` in a `private` schema the API doesn't expose, so they can't be called as `/rest/v1/rpc/...`; the policies call them instead of recursing through RLS. Only the intended RPCs (`my_organizer`, `resubmit_organizer`, `admin_*`) stay in `public`, and each checks the caller itself |
| Storage | `public-media` bucket: public read, writes only under `avatars/<your user id>/` or `organizers/<your organizer id>/`, images ≤ 5 MB |

Verified by `npm run db:test` (79 checks covering role escalation, cross-user reads, forged chain rows, locked
fields, double check-in, double orders, storage paths).

## Threats & mitigations (summary — detailed per phase)

| Threat | Mitigation |
|---|---|
| Oversell | capacity enforced inside `mint_ticket` (atomic on-chain) |
| Double entry | `validate_and_check_in` marks ticket used on-chain; scanner keeps an offline seen-set |
| Screenshot / QR sharing | QR signed by holder device key with ~20 s freshness; credential bound to current owner |
| Replay of signed tx / API calls | Stellar sequence numbers + tx time bounds; API idempotency keys; QR timestamps + nonce |
| Double-spend of points | SEP-41 balances on-chain; redemption burns atomically |
| Scalping | `max_transfers`, `resale_cap` enforced on-chain |
| Brute force / abuse | per-IP + per-user rate limiting on auth, purchase and check-in endpoints |
| Linking someone else's wallet | The wallet must sign a one-time server challenge naming our domain, the wallet, the network, the purpose (login or link) and a 5-minute expiry; the challenge is claimed with a single conditional `UPDATE`, so it can't be replayed; a wallet can belong to only one account |
| Data leakage between tenants | Postgres row-level security on every table; organizers see only their events |
| Injection / malformed input | zod validation on every route handler and server action |
