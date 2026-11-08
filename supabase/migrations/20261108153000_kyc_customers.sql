-- SEP-12 KYC status per user. Field values and ID documents are never stored here;
-- they go straight to the anchor. Users may only read their own row.

create type public.kyc_status as enum ('accepted', 'processing', 'needs_info', 'rejected');

create table public.kyc_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  account public.stellar_account,
  status public.kyc_status not null default 'needs_info',
  anchor_customer_id text,
  fields_needed jsonb not null default '[]'::jsonb,
  message text,
  home_domain text,
  provider text not null default 'sep24',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index kyc_customers_anchor_id on public.kyc_customers (anchor_customer_id)
  where anchor_customer_id is not null;

create trigger kyc_customers_updated_at before update on public.kyc_customers
  for each row execute function public.set_updated_at();

alter table public.kyc_customers enable row level security;

grant select on public.kyc_customers to authenticated;

create policy kyc_customers_select_own on public.kyc_customers
  for select to authenticated
  using (user_id = (select auth.uid()));
