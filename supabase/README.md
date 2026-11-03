# Supabase

| Path | What |
|---|---|
| `migrations/20261001000100_core_schema.sql` | enums, tables, constraints, indexes, split validation |
| `migrations/20261001000200_auth_and_rls.sql` | sign-up trigger, role helpers, table/column grants, RLS policies, locked-field triggers |
| `migrations/20261001000300_rpc.sql` | RPCs: `my_organizer`, `resubmit_organizer`, `admin_*` |
| `migrations/20261001000400_storage.sql` | `public-media` bucket + folder-scoped upload policies |
| `tests/` | RLS test suite + a minimal Supabase shim, run in plain Postgres via Docker |
| `seed.sql` | demo perk (local). Organizers, events, and tiers still arrive with later phases |

## Run the app against a local database

```bash
supabase start --eager          # Postgres + Auth + Storage + Mailpit. See ../SETUP.md
supabase status --env           # API_URL, PUBLISHABLE_KEY, SECRET_KEY → apps/web/.env.local
```

Sign-in codes are captured by Mailpit at http://127.0.0.1:54324. They are not sent to a real inbox.

## Test the schema without the full stack (Docker)

```bash
npm run db:test    # fresh Postgres in Docker → shim → all migrations → 79 RLS/privilege checks
npm run db:types   # regenerate apps/web/src/lib/supabase/database.types.ts from the migrations
```

## Apply to a Supabase project

Pick one:
- **Cursor + Supabase MCP**: ask the agent to apply the migrations; it runs them in order with `apply_migration`.
- **Supabase CLI**: `supabase link --project-ref <ref>` then `supabase db push`.
- **Dashboard**: paste each file from `migrations/` into the SQL editor, oldest first.

Then put the project URL, publishable key and secret key into `apps/web/.env.local`
(Project Settings → API Keys), and set `ADMIN_EMAILS` to your email.

## Auth settings (Dashboard → Authentication)

1. **Sign In / Providers → Email**: enabled. "Confirm email" can stay on; OTP sign-in confirms the address.
2. **URL Configuration**: Site URL = `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:3000`). Redirect URLs: add
   `http://localhost:3000/auth/callback` and your production `/auth/callback`.
3. **Emails → Magic Link** template: include the code so people can type it on the device where they started,
   even if the email opens in another app. Recommended body:

   ```html
   <h2>Your BY Tickets sign-in code</h2>
   <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">tap here to sign in</a>.</p>
   <p>The code expires in 1 hour. If you didn't ask for it, ignore this email.</p>
   ```

   The `/auth/confirm` link works across devices. The default `{{ .ConfirmationURL }}` link uses PKCE via
   `/auth/callback` and only works in the browser that asked for the code.
4. **Rate limits**: defaults are fine for testing. Add custom SMTP before launch (the built-in mailer is limited
   to a few emails per hour).
