-- Demo rows for local development. Applied by `supabase db reset` (and a fresh `supabase start`).
-- Idempotent. Does not create auth users — sign in through the app to get a profile.

insert into public.perks (id, chain_perk_id, title, description, sponsor_name, cost_units, stock, active)
values (
  '11111111-1111-4111-8111-111111111111',
  1,
  'Welcome drink',
  'One soft drink at a BY Tickets partner venue.',
  'BY Tickets',
  5000000,
  100,
  true
)
on conflict (id) do nothing;
