-- SEP-24 on/off-ramp transfers. Users may only read their own rows; writes go through
-- trusted server code (service role) after talking to the anchor.

create type public.ramp_kind as enum ('deposit', 'withdraw');
create type public.ramp_tx_status as enum (
  'pending',
  'awaiting_customer',
  'settled',
  'failed',
  'error',
  'refunded',
  'expired'
);

create table public.ramp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.ramp_kind not null,
  amount numeric(39, 7) not null check (amount >= 0),
  asset_code text not null check (char_length(asset_code) between 1 and 12),
  asset_issuer text check (asset_issuer is null or asset_issuer ~ '^G[A-Z2-7]{55}$'),
  anchor_tx_id text,
  status public.ramp_tx_status not null default 'pending',
  provider text not null default 'sep24',
  home_domain text,
  interactive_url text,
  memo text,
  withdraw_account text,
  order_id uuid references public.orders (id) on delete set null,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ramp_transactions_user on public.ramp_transactions (user_id, created_at desc);
create unique index ramp_transactions_anchor_tx on public.ramp_transactions (anchor_tx_id)
  where anchor_tx_id is not null;

create trigger ramp_transactions_updated_at before update on public.ramp_transactions
  for each row execute function public.set_updated_at();

alter table public.ramp_transactions enable row level security;

grant select on public.ramp_transactions to authenticated;

create policy ramp_transactions_select_own on public.ramp_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));
