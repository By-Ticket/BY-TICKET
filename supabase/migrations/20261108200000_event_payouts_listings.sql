-- Royalty snapshot, organizer payout records, and public ticket resale listings.
-- Listings and payouts are written by trusted server code after on-chain confirmation.

alter table public.events
  add column if not exists royalty_bps integer not null default 0
    check (royalty_bps between 0 and 1500);

create table public.event_payouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  amount_units public.token_units not null check (amount_units >= 0),
  tx_hash public.tx_hash not null unique,
  partial boolean not null default false,
  ramp_tx_id uuid references public.ramp_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index event_payouts_event on public.event_payouts (event_id, created_at desc);

alter table public.event_payouts enable row level security;
grant select on public.event_payouts to authenticated;
create policy event_payouts_select_own on public.event_payouts
  for select to authenticated
  using (private.is_event_organizer(event_id));

create type public.listing_status as enum ('listed', 'reserved', 'sold', 'cancelled');

create table public.ticket_listings (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  seller_user_id uuid not null references public.profiles (id) on delete cascade,
  seller_wallet_id uuid not null references public.wallets (id) on delete restrict,
  seller_public_key public.stellar_account not null,
  price_units public.token_units not null check (price_units >= 0),
  fiat_payout boolean not null default false,
  status public.listing_status not null default 'listed',
  buyer_user_id uuid references public.profiles (id) on delete set null,
  buyer_public_key public.stellar_account,
  unsigned_xdr text,
  seller_signed_xdr text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ticket_listings_open on public.ticket_listings (ticket_id)
  where status in ('listed', 'reserved');
create index ticket_listings_status on public.ticket_listings (status, created_at desc);

create trigger ticket_listings_updated_at before update on public.ticket_listings
  for each row execute function public.set_updated_at();

alter table public.ticket_listings enable row level security;
grant select on public.ticket_listings to anon, authenticated;
create policy ticket_listings_select on public.ticket_listings
  for select to anon, authenticated
  using (
    status = 'listed'
    or seller_user_id = (select auth.uid())
    or buyer_user_id = (select auth.uid())
  );
