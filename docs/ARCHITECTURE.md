# Architecture

BY Tickets is a mobile-first PWA backed by Supabase for off-chain data and Stellar/Soroban as the source of
truth for **ownership, transfers, check-ins, points and badges**.

## System overview

```mermaid
flowchart LR
  subgraph Client["Client (PWA, mobile-first)"]
    C[Customer app<br/>browse · buy · My Tickets · rewards]
    O[Organizer dashboard<br/>events · tiers · analytics · payouts]
    S[Staff scanner<br/>camera QR · offline queue]
    A[Admin console<br/>approvals · fees · stats]
    FW[(Freighter wallet)]
    IDB[(IndexedDB<br/>offline check-in queue)]
  end

  subgraph Server["Next.js server (Route Handlers / Server Actions)"]
    API[REST API /api/*<br/>zod validation · rate limiting]
    QR[QR credential signer<br/>Ed25519]
    CUS[Custodial signer<br/>AES-GCM encrypted keys]
    PAY[Payment service<br/>USDC/XLM + PaymentRampAdapter]
    IDX[Chain indexer / sync<br/>contract events → DB]
  end

  subgraph Supabase
    AUTH[Auth<br/>email OTP / magic link]
    DB[(Postgres + RLS)]
    ST[(Storage<br/>event posters)]
  end

  subgraph Stellar["Stellar network (testnet → mainnet)"]
    RPC[Soroban RPC]
    ET[event_ticket contract]
    RW[rewards contract<br/>BY Points SEP-41]
    BG[attendance_badge contract]
    USDC[USDC SAC]
  end

  MM[[Mobile money ramp<br/>MTN · Airtel · Zamtel<br/>stub]]

  C & O & A --> API
  S --> IDB --> API
  C -- sign tx --> FW
  FW --> RPC
  API --> AUTH & DB & ST
  API --> QR & CUS & PAY
  CUS --> RPC
  PAY --> MM
  RPC --> ET
  ET -- mint on purchase / attendance --> RW
  ET -- mint after check-in --> BG
  ET -- fee now, escrow until complete --> USDC
  IDX -- getEvents --> RPC
  IDX --> DB
```

## Ticket purchase (wallet user)

```mermaid
sequenceDiagram
  autonumber
  participant U as Customer (PWA)
  participant F as Freighter
  participant API as Next.js API
  participant RPC as Soroban RPC
  participant ET as event_ticket
  participant TK as USDC SAC
  participant RW as rewards

  U->>API: POST /api/purchases/prepare {eventId, tierId, buyer}
  API->>API: validate (zod), rate-limit, check capacity & sale window
  API->>RPC: simulate mint_ticket(...)
  API-->>U: unsigned XDR + idempotency key
  U->>F: signTransaction(xdr)
  F-->>U: signed XDR
  U->>API: POST /api/purchases/submit {signedXdr, idempotencyKey}
  API->>RPC: sendTransaction
  RPC->>ET: mint_ticket(buyer, tier)
  ET->>TK: transfer price buyer→splits (organizer / artist / platform)
  ET->>RW: mint(buyer, purchase points)
  ET-->>RPC: ticket_id + events
  API->>API: record ticket (pending → confirmed), idempotent on key
  API-->>U: ticket confirmed
```

Email (custodial) users follow the same flow, except the server signs with the user's decrypted custodial
key and the platform account sponsors fees.

## Check-in (works offline)

```mermaid
sequenceDiagram
  autonumber
  participant H as Holder device
  participant S as Scanner (staff PWA)
  participant Q as IndexedDB queue
  participant API as Next.js API
  participant ET as event_ticket
  participant BG as attendance_badge

  H->>H: render QR = credential + timestamp, signed by device key (rotates ~20s)
  S->>S: verify server sig (public key) + device sig + freshness
  S->>Q: check local seen-set → accept & enqueue
  Note over S,Q: works with no connectivity
  Q-->>API: sync when online (batched, idempotent)
  API->>ET: validate_and_check_in(ticket_id, scanner)
  ET->>ET: reject if already used (final double-entry guard)
  ET->>BG: mint_badge(event, attendee)
  API-->>S: confirmed / conflict list
```

## Responsibilities: on-chain vs off-chain

| Concern | On-chain (Soroban) | Off-chain (Supabase) |
|---|---|---|
| Ticket ownership & transfers | ✅ source of truth | mirrored for fast queries |
| Capacity / oversell | ✅ enforced in `mint_ticket` | pre-check for UX only |
| Check-in / double entry | ✅ final | offline seen-set on scanner |
| Points & badges | ✅ | cached balances & history |
| Event descriptions, images, tiers metadata | — | ✅ (+ hash anchored on-chain) |
| Users, roles, organizer approval | role addresses on-chain | ✅ profiles, RLS |

## Data model (Supabase)

Rows marked *chain mirror* hold an on-chain id and tx hash and are written only by the server after the
transaction is verified (see SECURITY.md → Database access model).

```mermaid
erDiagram
  auth_users ||--|| profiles : "trigger creates"
  profiles ||--o{ user_roles : has
  profiles ||--o{ wallets : owns
  wallets ||--o| custodial_keys : "encrypted secret"
  profiles ||--o| organizers : "applies as"
  organizers ||--o{ events : runs
  events ||--o{ ticket_tiers : offers
  events ||--o{ event_scanners : "door staff"
  profiles ||--o{ orders : places
  ticket_tiers ||--o{ orders : "for"
  orders ||--o{ tickets : "mints (chain mirror)"
  tickets ||--o{ ticket_transfers : "chain mirror"
  tickets ||--o{ ticket_credentials : "QR device keys"
  tickets ||--o{ checkins : "door scans"
  profiles ||--o{ points_ledger : "chain mirror"
  events ||--o{ badges : "chain mirror"
  perks ||--o{ redemptions : "chain mirror"

  events {
    uuid id PK
    uuid organizer_id FK
    text title
    timestamptz starts_at
    int capacity
    int max_transfers
    numeric resale_cap_units
    jsonb splits
    event_status status
    bigint chain_event_id UK
  }
  tickets {
    uuid id PK
    bigint chain_ticket_id UK
    text owner_public_key
    uuid owner_user_id FK
    ticket_status status
    text mint_tx_hash UK
  }
  orders {
    uuid id PK
    numeric total_units
    payment_method payment_method
    order_status status
    text idempotency_key
    text tx_hash UK
  }
```

Also: `platform_settings` (fee, FX rate), `audit_log`, `chain_cursors` (indexer position per contract),
`idempotency_keys`, `wallet_challenges` (Freighter ownership proofs).

## Code layout

```
apps/web/src/
  proxy.ts        session refresh + optimistic redirect for protected routes
  app/            routes (customer, organizer, scanner, admin, login, auth callbacks) + /api route handlers
  components/     ui/ (shadcn), layout/, forms/, feature components
  lib/
    env.ts        zod-validated environment
    auth/         session (getViewer / requireRole), sign-in bootstrap, safe redirects
    custodial/    AES-256-GCM key sealing, custodial wallet provisioning
    stellar/      network config, RPC client, contract clients, Freighter helpers
    supabase/     browser / server / admin clients, generated database.types.ts
    validation/   zod schemas shared by Server Actions and tests
    payments/     pricing (USDC ↔ ZMW), PaymentRampAdapter + stub
    security/     rate limiting, Server Action guard
contracts/        Soroban workspace: event_ticket, rewards, attendance_badge
supabase/         migrations/, tests/ (RLS suite + Supabase shim), seed.sql
scripts/          gen-secrets, gen-db-types, deploy-testnet, smoke-testnet
```
