# Fiat on/off-ramp (SEP-24) and KYC (SEP-12)

Fans can pay for tickets in local currency through a Stellar Anchor. Organizers can cash out USDC
after `release_payout` to the same anchor. Contracts are unchanged: they still settle in the mock
USDC token on testnet. Identity checks use SEP-12 against that anchor before a deposit or cash-out.

## Providers

| `RAMP_PROVIDER` | Behaviour |
|---|---|
| `stub` (default) | Auto-approves. Use in tests and local dev. |
| `sep24` | Live SEP-24 adapter (`Sep24RampAdapter`). |
| `mtn_momo` / `airtel_money` / `zamtel_kwacha` | Metadata only — not implemented. Reserved for a future Zambian anchor. |

`PAYMENT_RAMP_PROVIDER` is a deprecated alias of `RAMP_PROVIDER`.

## Environment

Set these in `apps/web/.env.local` (see `apps/web/.env.example`).

| Variable | Required | Notes |
|---|---|---|
| `RAMP_PROVIDER` | no | `stub` or `sep24`. Default `stub`. |
| `ANCHOR_HOME_DOMAIN` | for `sep24` | Host only, no scheme. Defaults to `testanchor.stellar.org` on testnet. |
| `KYC_THRESHOLD_AMOUNT` | no | USDC amount below which fan deposits may skip KYC if the anchor allows it. Default `0` (always check). Cash-out is never skipped. |
| `ANCHOR_CALLBACK_SECRET` | for live callbacks | Shared secret or HMAC key. `POST /api/ramp/callbacks` rejects unsigned requests. |

The app fetches `https://<ANCHOR_HOME_DOMAIN>/.well-known/stellar.toml` and reads:

- `TRANSFER_SERVER_SEP0024`
- `WEB_AUTH_ENDPOINT`
- `SIGNING_KEY`
- `KYC_SERVER` (falls back to `TRANSFER_SERVER`, then the SEP-24 transfer server)

## Flows

1. **SEP-10.** Request a challenge, have the selected Stellar wallet sign it (Freighter via the existing
   kit; custodial wallets sign on the server). Verify the server signature against `SIGNING_KEY`, then
   exchange the signed challenge for a JWT. The JWT is stored in the `by_sep10` **httpOnly** cookie for
   this session only — never in `localStorage`.
2. **Fan deposit.** Checkout → **Pay with local currency** → `POST /transactions/deposit/interactive`
   for the ticket asset → open the anchor URL in a popup/iframe → poll `GET /transaction` until it
   completes → existing `mint_ticket` purchase. UI states: pending, incomplete / awaiting customer,
   error, refunded, expired.
3. **Organizer withdraw.** Organizer dashboard → **Cash out to local currency** (after `release_payout`)
   → `/transactions/withdraw/interactive` → send the asset payment to the anchor account with the
   required memo → poll until complete.

If `GET /info` does not list the ticket asset code **and issuer** (`NEXT_PUBLIC_USDC_ASSET_CODE` /
`NEXT_PUBLIC_USDC_ISSUER`), the UI explains that this anchor cannot take that asset. SDF's test
anchor lists Circle testnet USDC, not BY Tickets' mock USDC, so that message is expected until a
matching asset or a local test anchor is used.

## KYC (SEP-12)

1. Reuse the SEP-10 JWT (`by_sep10` cookie).
2. `GET /customer` on `KYC_SERVER`. Map `ACCEPTED`, `PROCESSING`, `NEEDS_INFO`, `REJECTED`.
3. **Pay with local currency:** if `NEEDS_INFO`, show a form built from the fields the anchor asked
   for (files go to the anchor, never into our database). If `PROCESSING`, show a pending state. If
   `REJECTED`, block the purchase. Amounts below `KYC_THRESHOLD_AMOUNT` may proceed without KYC when
   the status is not rejected.
4. **Organizer cash-out:** blocked until status is `ACCEPTED`. The organizer dashboard shows the
   current status.
5. After a successful GET, the app registers `PUT /customer/callback` pointing at
   `NEXT_PUBLIC_APP_URL/api/ramp/callbacks` when the anchor supports it. The same route also accepts
   transaction status updates via `Sep24RampAdapter.parseWebhook` (polling still runs).
6. **Resale proceeds:** listing with “cash out in local currency”, and later withdrawing those USDC,
   uses the same withdraw KYC gate as organizer cash-out.
7. `RAMP_PROVIDER=stub` writes `accepted` and skips the live anchor, so local checkout and tests
   still work.

## Database

`ramp_transactions` (migration `20261108144750_ramp_transactions.sql`): `id`, `user_id`, `kind`
(`deposit`/`withdraw`), `amount`, `asset_code`, `anchor_tx_id`, `status`, timestamps. RLS lets a
signed-in user select only their own rows; writes stay on the service role.

`kyc_customers` (migration `20261108153000_kyc_customers.sql`): one row per user (`user_id` PK),
`status`, `anchor_customer_id`, `fields_needed` (field names/types only), `message`. No document
bytes. RLS: `select` own row; writes via the service role.

`event_payouts` and `ticket_listings` (migration `20261108200000_event_payouts_listings.sql`): payout rows
link `ramp_tx_id` after cash-out; listings are public while `listed`. Writes via the service role.

Apply with `npx supabase db push` against the linked project (or the SQL editor).
