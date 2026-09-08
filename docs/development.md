# Development

## Requirements

Node 20.11+ (developed on 24). Nothing else — **no database server, no Docker,
no credentials.**

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account, and the product works.

On first run the app starts an embedded PostgreSQL (PGlite), applies all
migrations, and seeds the catalogue — 3 merchants, ~46 canonical products, ~104
listings and ~3,100 price observations, in about four seconds. Data persists in
`.bloom/pgdata`.

`cp .env.example .env.local` only if you want to change defaults; nothing in it
is required for local development.

## Commands

```bash
npm run dev            # dev server (auto-migrates and seeds on first run)
npm run build          # production build
npm start              # run the production build

npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --write
npm test               # unit + integration (vitest)
npm run test:coverage  # with coverage
npm run test:e2e       # Playwright (builds and starts its own server)
npm run verify         # typecheck + lint + test

npm run db:migrate     # apply migrations
npm run db:seed        # seed catalogue (idempotent)
npm run db:setup       # both
npm run db:reset       # drop and rebuild (refuses on a remote database)
```

## Two database modes

Set by `BLOOM_DB_DRIVER` (default `auto`).

**Embedded (default, no `DATABASE_URL`).** Real PostgreSQL 18 compiled to WASM,
running in-process. RLS, generated `tsvector` columns, GIN indexes and exact
`numeric` arithmetic all behave as in production. Not for production use — it is
a single-process, single-connection database.

**Remote (`DATABASE_URL` set).** Supabase or any Postgres. Migrations must be
applied explicitly; the app never modifies a remote schema at request time.

The same SQL runs against both, which is the point.

## Two auth modes

**Local (default).** Email + password, scrypt-hashed, in `local_auth_users`.
Sessions are HMAC-signed HttpOnly cookies. In development the signing key is
generated per process, so restarting the dev server signs you out.

**Supabase Auth.** Used automatically when `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are set.

> The Supabase path is complete and type-checked but **has not been run against
> a live Supabase project**, because no credentials have been provisioned. Treat
> first-run issues there as expected rather than surprising.

## Testing

```
tests/unit/          Pure logic. Fast, no I/O.
tests/integration/   Real PostgreSQL: migrations, seed, repositories, RLS.
tests/e2e/           Playwright against a real built server.
```

Integration tests build a fresh file-backed PGlite per file, run the real
migrations and the real seed pipeline, and delete it afterwards. They exercise
actual SQL — a mock would happily agree with a broken query.

The clock is pinned (`TEST_NOW`) so seeded price histories, and every deal score
derived from them, are identical on every run.

Two things worth knowing about the test setup:

- **Test files run sequentially** (`fileParallelism: false`). Each integration
  file holds a PGlite instance with a substantial WASM heap; running several in
  parallel forks exhausts the V8 zone allocator and kills the worker.
- **Integration databases are file-backed, not `memory://`.** An in-memory
  PGlite keeps the whole database inside the WASM heap, and a full seeded
  catalogue does not fit.

### E2E

```bash
npm run test:e2e
```

Playwright builds and starts its own server on port 3100 with a separate
database. It covers the definition-of-done journey — signup → onboarding → feed
→ search → product → save → merchant click — plus redirect safety and access
control, on desktop and mobile viewports.

If browsers are not installed: `npx playwright install chromium`.

## Project layout

```
app/            Routes. (marketing) (auth) (app) route groups; api/ and go/ handlers
components/     Presentation only — never touches the database
lib/            Domain logic and data access
  auth/         Provider seam + local and Supabase implementations
  db/           Db interface, two drivers, migrations, row coercion
  products/     Catalogue reads and card assembly
  deals/        Deal engine (pure)
  recommendations/  Scoring, diversity, feed assembly
  search/       Provider seam + Postgres implementation
  preferences/  Preference CRUD and behavioural learning
  engagement/   Save, like, reject
  affiliate/    Merchant click-out and redirect validation
  analytics/    Event recording
services/       Pipelines: ingestion, normalization, pricing
config/         Tunable values and controlled vocabulary
supabase/       Migrations and the seed catalogue
tests/          unit · integration · e2e
```

## Conventions

- Money is `numeric(12,2)` and converted explicitly via `lib/db/rows.ts`.
  Postgres returns `numeric` as a string.
- Scoring weights and thresholds live in `config/scoring.ts`. They are data.
- Vocabulary lives in `config/taxonomy.ts`. Adding a term is safe; renaming or
  removing one needs a data migration.
- Never import a `node:*`-using module into a Client Component. If a client
  needs a constant from a server module, move the constant to `config/`.
- Server Actions take the user id from the verified session, never from an
  argument.

## Troubleshooting

**Stale or broken local data** — `npm run db:reset`, or delete `.bloom/`.

**"Migration changed after it was applied"** — a migration file was edited after
being applied. Migrations are immutable; add a new one, or reset locally.

**Signed out after restarting `npm run dev`** — expected. Set
`BLOOM_AUTH_SECRET` in `.env.local` for a stable key.

**Type errors mentioning `PageProps` / `LayoutProps`** — Next generates route
types into `.next/types`. Run `npm run build` (or `npm run dev`) to regenerate.
