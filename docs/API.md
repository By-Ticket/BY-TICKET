# API Reference

> **Status:** health check, auth routes, Server Actions and database RPCs are implemented (Phases 1 and 3).
> The remaining endpoints are the planned surface, documented here as they land in Phases 4–7.

Conventions:
- JSON in/out, request bodies validated with zod; errors return `{ "error": { "code", "message", "details?" } }`.
- Auth via the Supabase session cookie; role checks on the server and RLS in Postgres.
- Mutations accept an `Idempotency-Key` header; repeat requests return the original result.
- Rate-limited per IP + user; `429` with `Retry-After` when exceeded.

## Implemented

### `GET /api/health`
Liveness and configuration check (never exposes secrets).

```json
{
  "status": "ok",
  "app": "BY Tickets",
  "network": "testnet",
  "rpc": { "url": "https://soroban-testnet.stellar.org", "reachable": true, "latestLedger": 123456 },
  "configured": { "supabase": false, "contracts": false, "qrSigning": false, "custodialKeys": false, "kycCallback": false, "kycThreshold": 0 }
}
```

### `POST /api/ramp/callbacks`
Anchor Platform customer and transaction status webhooks. Auth is `Authorization: Bearer <ANCHOR_CALLBACK_SECRET>`,
`x-callback-secret`, or `signature: sha256=<hmac>`. Updates `kyc_customers` / `ramp_transactions` status only —
never identity documents.

### Auth routes

| Method | Path | Does |
|---|---|---|
| `GET` | `/auth/callback?code=&next=` | magic-link (PKCE) landing: exchanges the code for a session cookie, runs the sign-in bootstrap, redirects to `next` |
| `GET` | `/auth/confirm?token_hash=&type=&next=` | email-template link that works across devices (`verifyOtp` with the token hash) |

Both redirect to `/login?error=link` on failure. `next` is sanitised to same-origin paths.

### Server Actions (form posts from the app)

All validate with zod, are rate-limited per IP and per identity, and run as the signed-in user (RLS applies).

| Action | Who | Input | Notes |
|---|---|---|---|
| `authenticate` (`/login`) | anyone | `intent=send`, `email` → `intent=verify`, `email`, `token` | email OTP; on success runs `afterSignIn` (admin bootstrap, custodial wallet) and redirects |
| `signOut` | signed in | — | clears the session |
| `updateProfile` (`/account`) | signed in | `display_name`, `phone?`, `city?` | |
| `submitOrganizerApplication` (`/organizer`) | signed in | `name`, `slug?`, `city`, `contact_email`, `contact_phone`, `bio?`, `payout_public_key?` | creates a pending application, or updates and resubmits a rejected one |
| `reviewOrganizer` (`/admin`) | admin | `organizer_id`, `status` (`approved` / `rejected` / `suspended`), `note?` | a note is required to reject |
| `beginCheckout` / `completeCheckout` (`/events/[id]`) | signed in | wallet, method `wallet` \| `mobile_money` \| `local_currency` | local currency is SEP-24; JWT stays in an httpOnly cookie; SEP-12 gates the deposit |
| `finishSep10Checkout` / `pollLocalCurrencyCheckout` | signed in | signed challenge or ramp id | polls the anchor until deposit completes, then mints |
| `checkKyc` / `finishSep10Kyc` / `submitKyc` | signed in | wallet + field values / files | files go to the anchor only; status is stored in `kyc_customers` |
| `beginCashOut` / `pollCashOut` / `submitCashOutPayment` (`/organizer`) | signed-in | amount + wallet, optional `payoutId` | SEP-24 withdraw after `release_payout` or resale proceeds; blocked until KYC is ACCEPTED |
| `beginCreateEvent` / `finishCreateEvent` / `beginEventAction` (`/organizer`) | organizer | event fields + wallet | on-chain `create_event` / complete / cancel / release / milestone |
| `beginClaimRefund` / `beginListTicket` / `beginApproveSale` (`/tickets`) | ticket owner | wallet + price | `claim_refund` or list/`transfer_ticket`; KYC if fiat payout |
| `beginBuyListing` / `finishBuyListing` (`/events/[id]`) | signed in | listing + wallet | shows fee/royalty/seller split, then `transfer_ticket` |

### Database RPCs (`supabase.rpc(name, args)`)

`SECURITY DEFINER` functions that authorise the caller themselves; `anon` can't execute them.

| RPC | Who | Returns |
|---|---|---|
| `my_organizer()` | signed in | the caller's organizer row, including private columns |
| `resubmit_organizer()` | rejected applicant | — (status back to `pending`) |
| `admin_list_organizers(p_status?)` | admin | applications with the applicant's account email |
| `admin_review_organizer(p_organizer_id, p_status, p_note?)` | admin | updated organizer; grants/revokes the `organizer` role; audited |
| `admin_set_role(p_user_id, p_role, p_enabled)` | admin | — (audited; admins can't remove their own admin role) |
| `admin_update_setting(p_key, p_value)` | admin | — (audited) |
| `admin_stats()` | admin | `{ users, organizers_pending, organizers_approved, events_published, tickets_sold, tickets_checked_in, gross_units }` |

## Planned

| Method | Path | Role | Phase |
|---|---|---|---|
| `GET` | `/api/events` | public | 4 |
| `GET` | `/api/events/:id` | public | 4 |
| `POST` | `/api/purchases/prepare` | customer | 4 |
| `POST` | `/api/purchases/submit` | customer | 4 |
| `GET` | `/api/me/tickets` | customer | 5 |
| `POST` | `/api/tickets/:id/credential` | ticket owner | 5 |
| `POST` | `/api/tickets/:id/transfer` | ticket owner | 5 |
| `POST` | `/api/checkins/sync` | scanner | 5 |
| `POST` | `/api/organizer/events` | organizer | 6 |
| `PATCH` | `/api/organizer/events/:id` | organizer | 6 |
| `GET` | `/api/organizer/events/:id/analytics` | organizer | 6 |
| `GET` | `/api/organizer/payouts` | organizer | 6 |
| `GET` | `/api/me/rewards` | customer | 7 |
| `POST` | `/api/rewards/redeem` | customer | 7 |
| `POST` | `/api/admin/organizers/:id/approve` | admin | 6 |
| `PATCH` | `/api/admin/fees` | admin | 6 |
| `GET` | `/api/admin/stats` | admin | 6 |
