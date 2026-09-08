# Architecture

Bloom is a personalised shopping discovery and price-intelligence layer. It is
not a marketplace, a checkout, or a payment platform. It helps someone find
products that suit them and decide whether now is a sensible time to buy.

## Shape of the system

One deployable Next.js application. No separate backend service, no message
queue, no cache tier, no search cluster. At Phase 1 scale none of those would
earn their operational cost, and every one of them is a thing that can be added
later behind an interface that already exists.

```
                    ┌────────────────────────────┐
                    │        Web client          │
                    │   React 19 · Server-first  │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │      Application layer     │
                    │                            │
                    │  lib/auth          auth    │
                    │  lib/search        search  │
                    │  lib/recommendations rank  │
                    │  lib/products      catalog │
                    │  lib/deals         pricing │
                    │  lib/engagement    signals │
                    │  lib/affiliate     clickout│
                    │  lib/analytics     events  │
                    └─────────────┬──────────────┘
                                  │  lib/db (Db interface)
                    ┌─────────────▼──────────────┐
                    │        PostgreSQL          │
                    │  Supabase  ·  or embedded  │
                    └─────────────┬──────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        Product data         User data          Event data
              ▲
              │  services/ingestion → services/normalization
              │
        MerchantProvider (seed today, real feeds later)
```

## Rendering model

Server-first. Pages are React Server Components that query the database
directly; there is no internal HTTP API for the app's own pages to call. Client
Components exist only where interaction genuinely requires them — the product
action buttons, the preference editor, the auth form.

Consequences worth knowing:

- Search, filtering and pagination work with JavaScript disabled, because they
  are GET forms and links rather than client state.
- Onboarding works with JavaScript disabled, because each step is a form POST.
- Mutations are Server Actions. Next.js verifies the `Origin` header on Server
  Action requests, which together with the `SameSite=Lax` session cookie is the
  CSRF control.

## The seams

Five interfaces exist because Bloom will predictably need to swap what is behind
them. Each has exactly one implementation today; none has speculative
configuration.

| Seam          | Interface                                        | Today                                   | Why it exists                                     |
| ------------- | ------------------------------------------------ | --------------------------------------- | ------------------------------------------------- |
| Database      | `Db` (`lib/db/types.ts`)                         | Supabase Postgres / embedded PGlite     | Develop and test without credentials              |
| Auth          | `AuthProvider` (`lib/auth/types.ts`)             | Local email+password / Supabase Auth    | Same                                              |
| Merchant data | `MerchantProvider` (`lib/merchants/provider.ts`) | Seed catalogue                          | Real feeds are not yet contracted                 |
| Search        | `SearchProvider` (`lib/search/types.ts`)         | PostgreSQL FTS                          | Keeps the "no search cluster" decision reversible |
| Analytics     | `lib/analytics/*`                                | Postgres event log (+ optional PostHog) | Vendor independence                               |

Deliberately _not_ abstracted: payments, checkout, financing, notifications.
Those are Phase 2 or later, and an interface with no implementation and no
caller is dead weight.

## Two real database drivers

No Supabase project has been provisioned, and Docker is not available in the
development environment. Rather than mock the database — which would let broken
SQL pass tests — Bloom runs **PostgreSQL 18 in-process** via PGlite for
development, tests and CI, and connects to Supabase Postgres in production.

The same migrations, indexes, constraints, RLS policies and queries execute
against both. `lib/db/connect.ts` picks the driver from configuration; nothing
above `lib/db` knows which one is active.

This is why `npm run dev` works immediately after a clone: the embedded database
migrates and seeds itself on first connection (`lib/db/index.ts`,
`bootstrapEmbedded`). That auto-bootstrap only ever runs for PGlite — a remote
database is migrated explicitly and never modified at request time.

## Layering

```
app/          Routes, pages, Server Actions. Composition only.
components/   Presentation. No database access.
lib/          Domain logic and data access. The application core.
services/     Batch/pipeline work: ingestion, normalization, pricing.
config/       Tunable values and vocabulary. Data, not logic.
types/        Shared domain shapes.
```

Rules that hold throughout:

- `components/` never imports from `lib/db` or `services/`.
- Client Components never import a module that imports `node:*`. Enforced in
  practice by `server-only` on server modules — and by the memory of a
  Client Component importing the password module and pulling `node:crypto`
  into the browser bundle.
- Money is `numeric(12,2)` in the database and is converted explicitly at the
  repository boundary (`lib/db/rows.ts`). Postgres returns `numeric` as a
  string; implicit coercion is how prices silently become `NaN`.

## Where the product logic lives

The three pieces that constitute Bloom's actual value are all pure, deterministic
TypeScript with no I/O, which makes them directly testable:

- `lib/deals/engine.ts` — price statistics and deal scoring
- `lib/recommendations/scoring.ts` — per-component preference scoring
- `lib/recommendations/diversity.ts` — feed composition

Everything around them is plumbing.

## Further reading

- [database.md](database.md) — schema, indexes, RLS
- [product-data.md](product-data.md) — ingestion, normalization, matching
- [deal-engine.md](deal-engine.md) — how a deal score is computed
- [recommendations.md](recommendations.md) — ranking and learning
- [analytics.md](analytics.md) — the funnel and the questions it answers
- [development.md](development.md) — running it locally
- [deployment.md](deployment.md) — going to production
- [decisions.md](decisions.md) — architecture decision records
