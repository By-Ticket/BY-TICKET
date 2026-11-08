-- Login-with-wallet challenges are issued before an account exists, so user_id
-- is nullable when purpose = 'login'. Link challenges still require a user.

alter table public.wallet_challenges
  alter column user_id drop not null;

alter table public.wallet_challenges
  add column purpose text not null default 'link';

alter table public.wallet_challenges
  add constraint wallet_challenges_purpose_check
  check (purpose in ('link', 'login'));

alter table public.wallet_challenges
  add constraint wallet_challenges_purpose_user
  check (
    (purpose = 'link' and user_id is not null)
    or (purpose = 'login' and user_id is null)
  );

create index wallet_challenges_login_key
  on public.wallet_challenges (public_key, created_at desc)
  where purpose = 'login';

comment on table public.wallet_challenges is
  'One-time signed-message challenges for linking a Stellar wallet or signing in with one. Service role only.';
