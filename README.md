# Bloom

Personalised shopping discovery and price intelligence.

Bloom learns what you like, surfaces products that match, and tells you whether
today's price is genuinely a good moment to buy — using recorded price history
rather than marketing claims. When it does not have enough data to judge, it
says so.

Phase 1 is a discovery and decision layer. It is not a marketplace, a checkout,
or a payment platform.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 and create an account. **No database server, no
Docker, and no credentials are needed.**

On first run the app starts an embedded PostgreSQL, applies its migrations, and
seeds a catalogue of ~46 products across 3 merchants with ~3,100 price
observations — in about four seconds.

## The loop

```
preferences ─► discovery ─► understanding ─► price intelligence
     ▲                                              │
     └────────── behavioural signal ◄── user action ┘
```

Everything else is secondary to making that loop work well.

## What is real, and what is not

|                                                        | Status                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Schema, migrations, RLS                                | Real, verified against PostgreSQL 18                                                             |
| Normalization, matching, deal engine, ranking, search  | Real, tested                                                                                     |
| Auth, preferences, saves, likes, rejections, click-out | Real, tested end to end                                                                          |
| **Product catalogue**                                  | **Seeded.** No merchant feed has been contracted                                                 |
| **Supabase Auth path**                                 | Complete and type-checked, but **never run against a live project** — no credentials provisioned |
| **PostHog / Sentry**                                   | Not configured. Both degrade to no-ops with structured logging                                   |

Brands and merchants in the seed catalogue are fictional. Prices are synthetic,
and every seeded price observation is marked `source = 'seed'` so it stays
distinguishable from real data — see [docs/product-data.md](docs/product-data.md).

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run verify         # typecheck + lint + test
npm test               # 159 unit and integration tests
npm run test:e2e       # Playwright, full user journey
npm run db:reset       # rebuild the local database from scratch
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · PostgreSQL
(Supabase in production, embedded PGlite for development and tests) · Vitest ·
Playwright.

Server-first: search, filtering, pagination and onboarding all work without
client JavaScript.

## Documentation

|                                               |                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [architecture.md](docs/architecture.md)       | System shape, layering, the five seams                           |
| [database.md](docs/database.md)               | Schema, indexes, row-level security                              |
| [product-data.md](docs/product-data.md)       | Ingestion, normalization, product matching                       |
| [deal-engine.md](docs/deal-engine.md)         | How a deal score is computed                                     |
| [recommendations.md](docs/recommendations.md) | Ranking, diversity, behavioural learning                         |
| [analytics.md](docs/analytics.md)             | Event taxonomy and the queries that answer the product questions |
| [development.md](docs/development.md)         | Running and testing locally                                      |
| [deployment.md](docs/deployment.md)           | Vercel + Supabase, and the pre-launch checklist                  |
| [decisions.md](docs/decisions.md)             | Architecture decision records                                    |

## Product principles

These are enforced in code, not just stated:

- **Never claim what the data does not support.** No "best price" or "lowest
  price" — Bloom only sees the merchants it has ingested. A deal band is not
  rendered at all when price history is too thin.
- **Never fabricate history.** Absent statistics render as "—", not as a guess.
- **Explain every recommendation.** The product page lists which preferences
  matched, which did not, and the full weighted score breakdown.
- **Everything inferred is visible and deletable.** The preferences page shows
  every belief Bloom holds, its weight, and where it came from.
- **A wrong product match is worse than a missing one.** Matching is exact-key
  only.

## Name

"Bloom" is a working name. Trademark, domain and app-store availability have
**not** been verified.

## Licence

Unlicensed / private.
