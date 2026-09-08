# Deployment

Target: Vercel + Supabase. Nothing in the architecture depends on Vercel
specifically — it is a standard Next.js application and will run anywhere Node
runs.

## Before you can deploy

These require your action; they cannot be done from the codebase.

1. **Create a Supabase project.** Free tier is sufficient for validation.
2. **Create a Vercel project** and connect the repository.
3. **Set environment variables** (below).
4. **Apply migrations** to the Supabase database.
5. **Decide on a domain.** The name "Bloom" has **not** been checked for
   trademark, domain or app-store availability. Do that before committing to it
   publicly.

## Environment variables

Every variable is documented in `.env.example`. The ones that matter in
production:

| Variable                        | Required                   | Notes                                                                                              |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Yes                        | Supabase pooler connection string                                                                  |
| `BLOOM_DB_DRIVER`               | Recommended                | Set to `postgres` so a missing URL fails loudly rather than silently starting an embedded database |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes                        | Enables Supabase Auth                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes                        | Public by design — RLS is what makes it safe                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`     | Only if needed             | **Server-only. Never expose.** Not used by request-handling code                                   |
| `BLOOM_AUTH_SECRET`             | If not using Supabase Auth | 32+ random bytes. The app refuses to start the local provider in production without it             |
| `NEXT_PUBLIC_APP_URL`           | Yes                        | Absolute URL of the deployment                                                                     |
| `NEXT_PUBLIC_POSTHOG_KEY`       | Optional                   | Absent → no analytics network calls at all                                                         |
| `SENTRY_DSN`                    | Optional                   | See below                                                                                          |
| `BLOOM_LOG_LEVEL`               | Optional                   | `info` in production                                                                               |

Generate an auth secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Never commit `.env` or `.env.local`.** Both are git-ignored. The service-role
key must never appear in any `NEXT_PUBLIC_*` variable — anything so prefixed is
compiled into the browser bundle.

## Applying migrations

Migrations are plain SQL and are **not** applied automatically against a remote
database. Either:

```bash
DATABASE_URL="postgresql://..." BLOOM_DB_DRIVER=postgres npm run db:migrate
```

or apply `supabase/migrations/*.sql` in filename order via the Supabase CLI or
SQL editor.

Then seed the catalogue if you want the demonstration data:

```bash
DATABASE_URL="postgresql://..." BLOOM_DB_DRIVER=postgres npm run db:seed
```

Seeding is idempotent. Note that every seeded price observation is written with
`source = 'seed'` and can be deleted wholesale once real merchant data arrives:

```sql
delete from price_history where source = 'seed';
```

## Supabase configuration

1. **Connection string.** Project Settings → Database → Connection string. Use
   the pooler. `prepare: false` is already set in the driver, which the
   transaction-mode pooler requires.
2. **Auth.** Enable email/password. Set the site URL and redirect URLs to your
   deployment.
3. **Verify RLS is on.** After migrating, confirm no user table is left
   unprotected:

```sql
select relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
```

The tables in that list must not include `profiles`, `user_preferences`,
`saved_products`, `product_likes`, `product_rejections`, `user_events`,
`affiliate_clicks` or `local_auth_users`.

## Merchant hosts

Two places must know about a merchant's domains, and both fail closed:

1. `merchants.allowed_hosts` — outbound redirects are refused otherwise.
2. `images.remotePatterns` in `next.config.ts` — currently permissive
   (`hostname: '**'`) for development. **Narrow this to real merchant image
   hosts before production**, so the image optimizer cannot be pointed at
   arbitrary origins.

## Error tracking

No Sentry DSN has been provisioned, so errors go to the structured logger
(`lib/logging/logger.ts`), which emits single-line JSON in production for a log
drain to parse. Sensitive keys are redacted.

`reportError()` is the attachment point. To wire Sentry:

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

then call `Sentry.captureException(error, { extra: context })` inside
`reportError`, next to the existing `logger.error` call. Nothing else needs to
change — every server error path already routes through that one function and
returns a short reference id that is safe to show a user.

## Pre-launch checklist

- [ ] `npm run verify` passes (typecheck, lint, 159 tests)
- [ ] `npm run test:e2e` passes against a production build
- [ ] Migrations applied; RLS verified with the query above
- [ ] `BLOOM_DB_DRIVER=postgres` set, so a missing `DATABASE_URL` fails loudly
- [ ] `BLOOM_AUTH_SECRET` set (or Supabase Auth configured)
- [ ] No `NEXT_PUBLIC_*` variable contains a secret
- [ ] `images.remotePatterns` narrowed to real merchant hosts
- [ ] Merchant `allowed_hosts` populated for every active merchant
- [ ] Merchant redirects tested end to end
- [ ] Seeded price history removed if the catalogue is real
- [ ] Trademark / domain availability for the name confirmed

## Cost

The Phase 1 architecture is designed to run at or near zero.

| Service  | Tier      | Cost                                 |
| -------- | --------- | ------------------------------------ |
| Vercel   | Hobby/Pro | $0–20/mo                             |
| Supabase | Free      | $0 (500MB, ample for this catalogue) |
| PostHog  | Free      | $0 (1M events/mo)                    |
| Sentry   | Free      | $0                                   |

Nothing paid has been introduced. Postgres full-text search rather than a search
service, a Postgres event table rather than a data warehouse, and no cache tier
are all deliberate — see [decisions.md](decisions.md). Before adding a paid
service, state why it is needed, estimate the cost, and name the cheaper
alternative being rejected.
