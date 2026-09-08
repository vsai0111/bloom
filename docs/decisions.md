# Architecture decision records

Lightweight ADRs. Each records what was decided, why, and what it costs — so a
future engineer can tell a deliberate choice from an accident.

---

## ADR-0001 — One Next.js application, no separate backend

**Status:** Accepted

**Context.** The brief specifies Next.js with server-side capabilities and warns
against premature microservices.

**Decision.** One deployable application. Server Components query the database
directly; there is no internal HTTP API for the app's own pages.

**Consequences.** Fewer moving parts, no network hop between page and data, one
deploy. Cost: the web tier and the data tier scale together, and a future
background worker (price polling) will need to live elsewhere. Acceptable —
scaling them separately is a problem worth having.

---

## ADR-0002 — Two real database drivers behind one `Db` interface

**Status:** Accepted

**Context.** No Supabase project was provisioned, and Docker was unavailable in
the development environment. The brief demands the app work end to end on seeded
data and forbids fake functionality.

**Options.**

1. Mock the database in tests. Rejected: a mock agrees with broken SQL, so
   migrations, RLS and queries would be unverified.
2. Require Docker + local Supabase. Rejected: heavy setup, and unavailable here.
3. Run real PostgreSQL in-process via PGlite for dev and test; Supabase Postgres
   in production. **Chosen.**

**Decision.** `Db` (`lib/db/types.ts`) with a `postgres` driver and a `pglite`
driver. The same migrations, indexes, constraints, RLS policies and queries run
against both.

**Consequences.** `npm run dev` and `npm test` work immediately after a clone
with no credentials, and every SQL statement is genuinely executed. Production
remains Supabase; the driver is a dev/test facility, not a second production
target. Cost: PGlite is single-connection and memory-hungry, which forced
sequential test files and file-backed rather than in-memory test databases
(both documented in `vitest.config.mts` and `tests/helpers/db.ts`).

This is additive to the specified architecture rather than a change to it.

---

## ADR-0003 — Canonical products separate from merchant listings

**Status:** Accepted

**Decision.** `products` (one row per real-world product) is distinct from
`merchant_products` (one row per merchant's listing), with identity decided by
`products.match_key` under a unique constraint.

**Consequences.** Offer comparison, per-listing price history and honest deal
scoring all become possible. Cost: product matching becomes a correctness
problem, and getting it wrong merges unrelated products — which is why
matching is deterministic only (ADR-0004).

---

## ADR-0004 — Deterministic product matching, no fuzzy similarity

**Status:** Accepted

**Context.** Merchant titles for the same product differ substantially.

**Decision.** Three exact-match strategies only: validated GTIN, brand + MPN,
brand + canonicalised title. No similarity thresholds, no embeddings. The
strategy name is part of the key, so strategies cannot collide.

**Rationale.** Incorrect matching is worse than incomplete matching. Showing "3
merchants" for products that are not the same actively misinforms a user about
price. Missing a merge merely loses a comparison.

**Consequences.** Some genuine duplicates go unmerged. Accepted.

This was validated the hard way: `findMpn` initially accepted a bare `style`
attribute key, so `style: "minimal"` was treated as a part number and collapsed
every minimal-styled product from a brand into one — 36 canonical products
instead of 46. Now covered by a permanent invariant test (no product may have
more listings than there are merchants) and a unit regression test.

---

## ADR-0005 — PostgreSQL full-text search, no search engine

**Status:** Accepted

**Context.** Elasticsearch, Algolia, Typesense and vector databases were all
considered and explicitly warned against by the brief.

**Decision.** A weighted generated `tsvector` column with a GIN index, queried
via `websearch_to_tsquery`, behind a `SearchProvider` interface.

**Rationale.** At a few thousand products this is genuinely sufficient and costs
nothing extra to run. A search service would add a service to operate, a sync
pipeline to keep correct, and a monthly bill, for no measurable gain.

**Revisit when.** Relevance complaints from real users, catalogue beyond ~100k
products, or a need for typo tolerance and semantic matching. The interface
exists so that is a contained change.

---

## ADR-0006 — Events in Postgres, analytics vendor as a mirror

**Status:** Accepted

**Decision.** `user_events` is the source of truth. PostHog, when configured,
receives a copy for exploration.

**Rationale.** The funnel questions in [analytics.md](analytics.md) are
answerable with SQL and no vendor account; behavioural learning reads the same
events it writes; and the funnel survives changing vendor.

**Consequences.** Event volume lands in the primary database. Fine at this
scale; if it stops being fine, the table is a candidate for partitioning or a
separate store.

---

## ADR-0007 — RLS plus explicit query scoping

**Status:** Accepted

**Context.** Bloom's server connects as a trusted role, which RLS does not
constrain. It would be easy to conclude RLS is therefore pointless here.

**Decision.** Both. RLS policies on every user table, _and_ every repository
query scoped by `user_id` explicitly.

**Rationale.** RLS is what makes Supabase's public anon key safe — without it,
anyone with that key reads every user's data over PostgREST. Explicit scoping is
what protects the server path, where RLS does not apply. Neither is trusted as
the only control.

**Consequences.** Some duplication of intent. Verified by
`tests/integration/rls.test.ts`, which assumes the `authenticated` role and
attempts cross-user reads, writes and deletes.

---

## ADR-0008 — Missing evidence is stated, never estimated

**Status:** Accepted

**Decision.** Deal score components with no supporting data are dropped and the
remaining weights renormalised. With no evidence at all the score is a neutral
50 and `limitedEvidence` is set — and `DealBadge` then refuses to render a band,
showing "Not enough price history" instead.

**Rationale.** The product's entire claim is that its price judgements are
trustworthy. A confident "Great deal" derived from two observations destroys
that for a marginal engagement gain.

**Consequences.** Newly-ingested products show no deal band until history
accumulates. That is the correct behaviour.

---

## ADR-0009 — Deterministic ranking, no learned model

**Status:** Accepted

**Decision.** Six weighted, independently-computed scoring components. No
collaborative filtering, no embeddings.

**Rationale.** There is no engagement data yet to train on. More importantly,
the product's differentiator is _explaining why_ something is recommended — the
product page shows which preferences matched and the full component breakdown.
A learned model would remove that at exactly the stage where it is most
valuable.

**Consequences.** Ranking quality is bounded by hand-tuned weights. They live in
`config/scoring.ts` as data, so tuning never touches logic, and each component
is independently replaceable.

---

## ADR-0010 — Grouped preference matching

**Status:** Accepted

**Context.** Naïvely, matching 1 of a user's 3 colour preferences scores 1/3.

**Decision.** Group preferences by attribute; each group scores on its best
match relative to its strongest preference.

**Rationale.** Otherwise stating more preferences makes every product score
worse — the system would punish users for telling it more, which is the exact
opposite of the intended loop.

---

## ADR-0011 — Explicit preferences outrank behavioural, and weak signals must repeat

**Status:** Accepted

**Decision.** Explicit source weight 1.0 vs behavioural 0.5. A behaviourally
learned preference does not influence ranking until it has been reinforced at
least twice. Everything learned is listed on the preferences page with its
weight and source, and can be deleted.

**Rationale.** One curious click is not a stated taste. And a system that infers
things about you which you cannot see or correct is one you cannot trust.

---

## ADR-0012 — Merchant redirects validated against a per-merchant host allowlist

**Status:** Accepted

**Decision.** `/go/[merchantProductId]` accepts an internal listing id only —
never a URL. The destination is looked up and validated against
`merchants.allowed_hosts` before any redirect. An empty allowlist denies
everything.

**Rationale.** Accepting a URL parameter would make Bloom an open redirect —
a phishing vector wearing our domain. Host matching is anchored on a dot
boundary so `evil-example.com` cannot satisfy an allowlist entry of
`example.com`.

**Consequences.** Onboarding a merchant requires populating `allowed_hosts`.
Fails closed, which is the correct direction.

---

## ADR-0013 — Server-rendered search and onboarding, no client state

**Status:** Accepted

**Decision.** Search state lives entirely in the query string; filters and
pagination are links and GET forms. Onboarding steps are form POSTs.

**Consequences.** Every result view is shareable, linkable and back-button
correct, and both flows work with JavaScript disabled. Cost: a full navigation
per filter change instead of an in-place update. At this page weight, fine.

---

## ADR-0014 — No Phase 2 interfaces defined in advance

**Status:** Accepted

**Decision.** No `PaymentProvider`, `CheckoutProvider`, `FinancingProvider` or
`NotificationProvider` exists. Only the five seams with a real implementation
today.

**Rationale.** The brief asks for sensible boundaries, not speculative ones. An
interface with no implementation and no caller is dead weight that will be wrong
by the time it is needed.

**Consequence.** The one forward-looking accommodation made is data, not code:
nullable conversion columns on `affiliate_clicks`, so attaching a merchant
postback later is an `UPDATE` rather than a migration on a table with traffic.

---

## ADR-0015 — The embedded database resolves its location from the runtime, not the project

**Status:** Accepted

**Decision.** `PGLITE_DATA_DIR` is a _configured_ location, not a filesystem
path to be used verbatim. `lib/db/data-dir.ts` resolves a relative value against
the project directory on an ordinary machine and against the OS temp directory
on a read-only serverless runtime. Absolute paths are honoured as given.
Migrations and the PGlite WASM image are added to the build's file tracing,
since both are read from disk at runtime rather than imported.

**Rationale.** The default `.bloom/pgdata` is relative, and a relative path is
meaningless without knowing what it is relative _to_. On Vercel that was the
read-only deployment bundle, so the first request that touched the database died
in `mkdir` and returned a 500. The driver had assumed a writable project
directory — an assumption true of every environment it had been run in, and
false of the one it was deployed to.

**Consequences.** A deployment without `DATABASE_URL` now serves, on a database
that is per-instance and does not survive a cold start. That is a demonstration
mode, not a production database, and it says so in the logs on every connect.
The durable fix remains setting `DATABASE_URL`; this ADR only ensures the
failure mode is an honest warning instead of a crash.
