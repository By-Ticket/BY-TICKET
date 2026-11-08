# Fiat on/off-ramp (SEP-24)

Fans can pay for tickets in local currency through a Stellar Anchor. Organizers can cash out USDC
after `release_payout` to the same anchor. Contracts are unchanged: they still settle in the mock
USDC token on testnet.

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

The app fetches `https://<ANCHOR_HOME_DOMAIN>/.well-known/stellar.toml` and reads:

- `TRANSFER_SERVER_SEP0024`
- `WEB_AUTH_ENDPOINT`
- `SIGNING_KEY`

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

## Database

`ramp_transactions` (migration `20261108144750_ramp_transactions.sql`): `id`, `user_id`, `kind`
(`deposit`/`withdraw`), `amount`, `asset_code`, `anchor_tx_id`, `status`, timestamps. RLS lets a
signed-in user select only their own rows; writes stay on the service role.

Apply with `npx supabase db push` against the linked project (or the SQL editor).
