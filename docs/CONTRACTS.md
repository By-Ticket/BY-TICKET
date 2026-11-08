# Contract Specifications

> **Status:** implemented, tested (64 unit/integration tests) and deployed to Stellar **testnet** (Phase 2).
> `event_ticket` **v2** (escrow, milestone payout, refunds, resale royalties) is live; `version()` returns 2.
> Source: [`contracts/`](../contracts).
> Deployment record: [`contracts/deployments/testnet.json`](../contracts/deployments/testnet.json).

All amounts are `i128` in the token's smallest unit (USDC and BY Points both use 7 decimals, so `1 USDC = 10_000_000`).
Every state-changing call requires `require_auth()` from the acting address and emits a contract event.
All three contracts take their admin in `__constructor` (no separate `init`, so they can't be front-run) and
support `upgrade(wasm_hash)` / `set_admin(new_admin)` (admin only) and `version() -> u32`.

## Testnet deployment

| Contract | ID |
|---|---|
| `event_ticket` | `CBBZ2U62CAXXZAKROVI7YFELJXILLZDNICL6SL3PUEIX4AEEGYHDSFQD` |
| `rewards` (BY Points, `BYPTS`) | `CB3XCW3EZQNIKHYYDYYG5WXQA3BJZK7RIHXFX2LIXHV775YE5STG3B3C` |
| `attendance_badge` | `CCHNNBCK5UKWSYGK4JPPBBWW6YCIRTTDGMD7LTRZXB74JZAHF4C5E3AT` |
| payment token (mock `USDC` SAC) | `CBM5X6RZPBJJYHGGGYMVCR2FDVEMNGCTP7NX6PFR2UBGB75FEFQJRVNL` |
| admin account | `GBWJYRCOAB7DVUQPXDF3QH3MH5FRIGSIIZWJAGWJ6TYGWM4RH6C36DXP` |
| treasury (platform account) | `GAIXDOU5TZVTNQFWBWY74R3BDGNFCQDVX62UVGUN53XPRT3GDXDL23RG` |

## Roles

| Role | Granted by | Can |
|---|---|---|
| `admin` | `__constructor` | set platform fee + treasury, reward rates, approve/revoke organizers, pause, upgrade, set minters, manage perks |
| `organizer` | admin: `approve_organizer` | create events, add tiers, change capacity/transfer rules/sales, enable/disable scanners, complete/cancel events, release escrow, set payout milestones for **own** events |
| `scanner` | event organizer: `set_scanner` | `validate_and_check_in` for that event only (the organizer can always check in too) |
| `minter` | admin: `set_minter` on `rewards` / `attendance_badge` | mint points / badges; the `event_ticket` contract is the minter |
| perk sponsor | admin: `set_perk(…, sponsor, …)` | toggle its own perk on/off |

## `event_ticket`

### Admin

| Function | Notes |
|---|---|
| `__constructor(admin, payment_token, treasury, fee_bps, rewards, badge, purchase_points_per_unit, attendance_points)` | `fee_bps ≤ 2000` (20 %) |
| `approve_organizer(organizer)` / `revoke_organizer(organizer)` | |
| `set_fee(fee_bps, treasury)` | applies to events created **after** the change (each event snapshots its fee) |
| `set_reward_rates(purchase_points_per_unit, attendance_points)` | points per 1 USDC paid; flat points per check-in |
| `set_paused(bool)` | blocks `mint_ticket` and `transfer_ticket`; check-in still works so live events aren't stranded |

### Organizer

| Function | Notes |
|---|---|
| `create_event(organizer, capacity, price, max_transfers, resale_cap, splits, metadata_hash, ends_at, royalty_bps) -> u64` | creates tier `0` at `price`; `splits`: 1–5 `{recipient, bps}` summing to exactly 10 000; `metadata_hash`: sha256 of the off-chain event record; `ends_at` unix time (0 = completable immediately); `royalty_bps` ≤ 1500 (15 %) |
| `add_tier(event_id, price, capacity) -> u32` | up to 10 tiers; tier capacity ≤ event capacity; event must be Live |
| `update_event(event_id, capacity, max_transfers, resale_cap, sales_open)` | capacity can't drop below tickets sold; event must be Live |
| `set_scanner(event_id, scanner, enabled)` | |
| `set_payout_milestone(caller, event_id, min_checkins, partial_release_bps)` | organizer or admin; optional partial escrow release while Live once `checked_in ≥ min_checkins` |
| `complete_event(caller, event_id)` | organizer or admin; requires ledger time ≥ `ends_at`; closes sales; unlocks full `release_payout` |
| `cancel_event(caller, event_id)` | organizer or admin; Live only, and only if no escrow has been released; holders then `claim_refund` |
| `release_payout(caller, event_id) -> i128` | organizer or admin; pays remaining escrow to `splits` after completion, or the configured partial share after the check-in milestone; blocked if cancelled |

### Customers and the door

| Function | Auth | Notes |
|---|---|---|
| `mint_ticket(payer, owner, event_id, tier) -> u64` | payer | checks not paused, Live, sales open, event capacity **and** tier capacity (no oversell); platform fee goes to the treasury immediately; organizer share is escrowed in the contract; mints purchase points to `owner`. `payer ≠ owner` lets the platform pay after a mobile-money on-ramp |
| `transfer_ticket(ticket_id, from, to, price)` | from (+ `to` if `price > 0`) | rejects used/refunded tickets, `transfers ≥ max_transfers`, `price > resale_cap`, self-transfer, cancelled/completed events. With `price > 0` the buyer pays fee → treasury, royalty → `splits`, remainder → seller |
| `claim_refund(owner, ticket_id) -> i128` | owner | after `cancel_event`, returns the escrowed organizer-share of that ticket's purchase price (platform fee stays with the treasury) |
| `validate_and_check_in(ticket_id, scanner) -> u64` | scanner | organizer or enabled scanner; marks used (any replay → `AlreadyCheckedIn`); blocked if cancelled; mints attendance points and the badge to the owner; returns the badge id |

### Views

`get_event(id) -> EventInfo`, `get_ticket(id) -> Ticket`, `is_organizer(addr)`, `is_scanner(event_id, addr)`,
`config() -> Config`, `paused()`, `quote_split(event_id, price) -> (fee, Vec<amount>)`,
`escrow_balance(event_id) -> i128`, `event_status(event_id) -> EventStatus` (`Live` / `Completed` / `Cancelled`),
`version() -> u32` (currently **2**).
There is deliberately no `tickets_of(owner)`: per-owner lists grow without bound in contract storage, so
"My Tickets" is served by the off-chain indexer (Supabase) built from contract events (see DECISIONS D-017).

### Escrow, payouts, refunds

Primary sales pay `fee = price × fee_bps / 10 000` to the treasury immediately. The remainder is transferred
into the contract and tracked per event (`escrow_balance`). Organizer/admin call `complete_event` after
`ends_at`, then `release_payout` which splits the remaining escrow by `event.splits` (rounding dust to the
last recipient). Optional `set_payout_milestone` lets a percentage of escrow go out while the event is still
Live once enough attendees have checked in. `cancel_event` blocks payouts; each holder `claim_refund`s their
escrowed `paid` amount. Example: 100 USDC, fee 250 bps, splits 70/30 → treasury 2.5 at purchase; 97.5 in
escrow; after completion organizer 68.25, artist 29.25.

### Resale royalty

On `transfer_ticket` with `price > 0`: platform fee (`fee_bps`) → treasury, organizer royalty (`royalty_bps`,
max 15 %) → `splits`, remainder → seller. `max_transfers` and `resale_cap` are unchanged.

### Events (topics → data)

| Event | Emitted by |
|---|---|
| `event_created(event_id, organizer)` | `create_event` |
| `event_updated(event_id)` | `update_event` |
| `tier_added(event_id)` | `add_tier` |
| `ticket_minted(event_id, owner)` → ticket_id, tier, price, payer, platform_fee | `mint_ticket` |
| `escrowed(event_id)` → amount, payer | `mint_ticket` (organizer share) |
| `ticket_transferred(ticket_id, from, to)` → price, transfers | `transfer_ticket` |
| `royalty_paid(event_id, ticket_id)` → amount | priced `transfer_ticket` when `royalty_bps > 0` |
| `released(event_id)` → amount, remaining, partial | `release_payout` |
| `refunded(event_id, ticket_id)` → owner, amount | `claim_refund` |
| `checked_in(event_id, ticket_id)` → owner, scanner, badge_id | `validate_and_check_in` |
| `scanner_set`, `organizer_set`, `config_updated`, `paused_set` | admin / organizer setters |

### Errors

| Code | Error | Code | Error |
|---|---|---|---|
| 1 | `NotOrganizer` | 11 | `AlreadyCheckedIn` |
| 2 | `NotEventOrganizer` | 12 | `TransferLimitReached` |
| 3 | `NotScanner` | 13 | `ResaleCapExceeded` |
| 4 | `EventNotFound` | 14 | `InvalidSplits` |
| 5 | `TierNotFound` | 15 | `InvalidAmount` |
| 6 | `TicketNotFound` | 16 | `InvalidCapacity` |
| 7 | `SoldOut` | 17 | `InvalidRecipient` |
| 8 | `TierSoldOut` | 18 | `TooManyTiers` |
| 9 | `SalesClosed` | 19 | `FeeTooHigh` |
| 10 | `NotOwner` | 20 | `Paused` |
| 21 | `RoyaltyTooHigh` | 26 | `AlreadyReleased` |
| 22 | `EventNotLive` | 27 | `AlreadyRefunded` |
| 23 | `EventNotCompleted` | 28 | `NothingToRelease` |
| 24 | `EventCancelled` | 29 | `MilestoneNotMet` |
| 25 | `TooEarly` | 30 | `EventNotCancelled` |

## `rewards` (BY Points, SEP-41)

Full SEP-41 interface: `allowance`, `approve`, `balance`, `transfer`, `transfer_from`, `burn`, `burn_from`,
`decimals` (7), `name`, `symbol`. Points are **non-transferable by default**: `transfer` / `transfer_from`
fail with `NonTransferable` until the admin calls `set_transferable(true)`. Burning always works.

| Extra function | Auth | Notes |
|---|---|---|
| `__constructor(admin, name, symbol)` | — | deployed as `"BY Points"` / `BYPTS` |
| `set_minter(minter, enabled)` | admin | |
| `mint(minter, to, amount, reason: Symbol)` | minter or admin | `reason`: `purchase`, `attend`, `promo`… (emitted in the event) |
| `set_perk(perk_id, cost, sponsor, stock: Option<u32>)` | admin | create/replace a perk; `None` stock = unlimited |
| `set_perk_active(caller, perk_id, active)` | admin or the perk's sponsor | |
| `redeem(from, perk_id) -> u64` | from | burns `cost`, decrements stock, returns a redemption id; all checks run before any write |
| `perk(id)`, `total_supply()`, `transferable()`, `is_minter(addr)`, `admin()` | — | views |

**Errors:** 1 `NotMinter`, 2 `InvalidAmount`, 3 `InsufficientBalance`, 4 `InsufficientAllowance`,
5 `NonTransferable`, 6 `InvalidExpiration`, 7 `PerkNotFound`, 8 `PerkInactive`, 9 `PerkOutOfStock`, 10 `NotPerkManager`.

## `attendance_badge` (POAP-style)

| Function | Auth | Notes |
|---|---|---|
| `__constructor(admin)` | — | |
| `set_minter(minter, enabled)` | admin | `event_ticket` is the minter |
| `mint_badge(minter, event_id, attendee) -> u64` | minter or admin | one per (event, attendee): a second call returns the existing id; non-transferable |
| `has_badge(event_id, attendee)`, `badge(id) -> Badge`, `badges_of(attendee) -> Vec<u64>`, `is_minter`, `admin` | — | views |

**Errors:** 1 `NotMinter`, 2 `BadgeNotFound`. **Events:** `badge_minted`, `minter_set`, `admin_changed`.

## Security properties and the tests that cover them

| Property | How |
|---|---|
| No oversell | event and tier `sold < capacity` checked before payment, inside one atomic transaction |
| No double-spend / double entry | `checked_in` flag; replay → `AlreadyCheckedIn` (unit test + live testnet smoke test) |
| No replay of signed calls | Soroban auth entries carry a nonce and expiry ledger; every mutating call `require_auth`s its actor |
| Payment = ticket | payment transfers and ticket mint happen in the same invocation; any failure reverts all |
| Resale rules | cap and transfer limit enforced on-chain; paid resales settle on-chain so the cap can't be bypassed in the same call |
| Least privilege | organizers only touch their own events; scanners are per-event; only `event_ticket` mints points and badges |
| Arithmetic | `overflow-checks = true` in release; fee ≤ 20 %; split bps must sum to 10 000 |

## Building, testing, deploying

Contract tooling runs on the host (see README). No Docker:

```bash
npm run contracts:test     # cargo test (64 tests)
npm run contracts:lint     # rustfmt --check + clippy -D warnings
npm run contracts:build    # stellar contract build → target/wasm32v1-none/release/*.wasm
npm run contracts:deploy   # deploy all three against Circle testnet USDC; write IDs to apps/web/.env.local
npm run contracts:smoke    # end-to-end purchase → check-in → points/badge on testnet
```

Deploy options (env vars): `USDC_MODE=circle|mock` (default `circle`: Circle's official
testnet USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; `mock` is a
local-only issuer the deployer can mint), `FEE_BPS`, `PURCHASE_POINTS_PER_UNIT`,
`ATTENDANCE_POINTS`, `ORGANIZER=G…` (approve an organizer right after deploying).
