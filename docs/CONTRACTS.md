# Contract Specifications

> **Status:** implemented, tested (53 unit/integration tests) and deployed to Stellar **testnet** (Phase 2).
> Source: [`contracts/`](../contracts). Deployment record: [`contracts/deployments/testnet.json`](../contracts/deployments/testnet.json).

All amounts are `i128` in the token's smallest unit (USDC and BY Points both use 7 decimals, so `1 USDC = 10_000_000`).
Every state-changing call requires `require_auth()` from the acting address and emits a contract event.
All three contracts take their admin in `__constructor` (no separate `init`, so they can't be front-run) and
support `upgrade(wasm_hash)` / `set_admin(new_admin)` (admin only) and `version() -> u32`.

## Testnet deployment

| Contract | ID |
|---|---|
| `event_ticket` | `CDX6WEKM7S5GFB7RP4G4SYCGJE2HCKTIHIB6GZBM5AU2EOCCKWY4QGTW` |
| `rewards` (BY Points, `BYPTS`) | `CBNV5HCYO42JKRB24ZTJNHYKKZB6E242IKWO2EGUHKIHMMYC6VTV57DQ` |
| `attendance_badge` | `CBJRSMM7WCS6HZT7PCIMGQW2HNEE4OTHES3AUTSA2F6Q27SASWCH365Z` |
| payment token (mock `USDC` SAC) | `CBM5X6RZPBJJYHGGGYMVCR2FDVEMNGCTP7NX6PFR2UBGB75FEFQJRVNL` |
| admin account | `GCERZXWWXYN5QJ5OJ37LB5VV5VWDDY6THVC4FAAED2LLYFQS5IYH5BEL` |
| treasury (platform account) | `GAIXDOU5TZVTNQFWBWY74R3BDGNFCQDVX62UVGUN53XPRT3GDXDL23RG` |

## Roles

| Role | Granted by | Can |
|---|---|---|
| `admin` | `__constructor` | set platform fee + treasury, reward rates, approve/revoke organizers, pause, upgrade, set minters, manage perks |
| `organizer` | admin: `approve_organizer` | create events, add tiers, change capacity/transfer rules/sales, enable/disable scanners for **own** events |
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
| `create_event(organizer, capacity, price, max_transfers, resale_cap, splits, metadata_hash) -> u64` | creates tier `0` at `price`; `splits`: 1–5 `{recipient, bps}` summing to exactly 10 000; `metadata_hash`: sha256 of the off-chain event record |
| `add_tier(event_id, price, capacity) -> u32` | up to 10 tiers; tier capacity ≤ event capacity |
| `update_event(event_id, capacity, max_transfers, resale_cap, sales_open)` | capacity can't drop below tickets sold |
| `set_scanner(event_id, scanner, enabled)` | |

### Customers and the door

| Function | Auth | Notes |
|---|---|---|
| `mint_ticket(payer, owner, event_id, tier) -> u64` | payer | checks not paused, sales open, event capacity **and** tier capacity (no oversell); pulls the price from `payer` and pays fee + splits in one transaction; mints purchase points to `owner`. `payer ≠ owner` lets the platform pay after a mobile-money on-ramp |
| `transfer_ticket(ticket_id, from, to, price)` | from (+ `to` if `price > 0`) | rejects used tickets, `transfers ≥ max_transfers`, `price > resale_cap`, self-transfer. With `price > 0` the buyer pays the seller atomically, so the cap is enforced on the real payment |
| `validate_and_check_in(ticket_id, scanner) -> u64` | scanner | organizer or enabled scanner; marks used (any replay → `AlreadyCheckedIn`); mints attendance points and the badge to the owner; returns the badge id |

### Views

`get_event(id) -> EventInfo`, `get_ticket(id) -> Ticket`, `is_organizer(addr)`, `is_scanner(event_id, addr)`,
`config() -> Config`, `paused()`, `quote_split(event_id, price) -> (fee, Vec<amount>)`.
There is deliberately no `tickets_of(owner)`: per-owner lists grow without bound in contract storage, so
"My Tickets" is served by the off-chain indexer (Supabase) built from contract events (see DECISIONS D-017).

### Revenue split

`fee = price × fee_bps / 10 000` goes to the treasury; the remainder is split by `bps`, with rounding dust going
to the last recipient so the payouts always sum to exactly `price`. Example (verified on testnet): 100 USDC,
fee 250 bps, splits 70/30 gives treasury 2.5, organizer 68.25, artist 29.25.

### Events (topics → data)

| Event | Emitted by |
|---|---|
| `event_created(event_id, organizer)` | `create_event` |
| `event_updated(event_id)` | `update_event` |
| `tier_added(event_id)` | `add_tier` |
| `ticket_minted(event_id, owner)` → ticket_id, tier, price, payer, platform_fee | `mint_ticket` |
| `ticket_transferred(ticket_id, from, to)` → price, transfers | `transfer_ticket` |
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
npm run contracts:test     # cargo test (53 tests)
npm run contracts:lint     # rustfmt --check + clippy -D warnings
npm run contracts:build    # stellar contract build → target/wasm32v1-none/release/*.wasm
npm run contracts:deploy   # deploy all three + mock USDC to testnet, write IDs to apps/web/.env.local
npm run contracts:smoke    # end-to-end purchase → check-in → points/badge on testnet
```

Deploy options (env vars): `USDC_MODE=mock|circle` (default `mock`: a test `USDC`
asset the deployer can mint; `circle` uses Circle's testnet USDC), `FEE_BPS`, `PURCHASE_POINTS_PER_UNIT`,
`ATTENDANCE_POINTS`, `ORGANIZER=G…` (approve an organizer right after deploying).
