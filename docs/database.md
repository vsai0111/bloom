# Database

PostgreSQL is the source of truth for everything: catalogue, users, preferences
and events. There is no second store.

## Migrations

Plain `.sql` files in `supabase/migrations/`, applied in filename order by
`lib/db/migrate.ts` and recorded in `schema_migrations` with a checksum.

```bash
npm run db:migrate    # apply outstanding migrations
npm run db:seed       # populate the catalogue (idempotent)
npm run db:setup      # both
npm run db:reset      # drop everything and rebuild (refuses on remote DBs)
```

Migrations are **immutable**. Editing one that has already been applied is a
hard error, because that is how two environments silently diverge. Add a new
migration instead.

The same files run against Supabase and against the embedded PGlite database.
Anything Supabase-specific is conditional:

- The `anon` / `authenticated` / `service_role` roles are created if absent.
- The `profiles.id → auth.users.id` foreign key is added only when the `auth`
  schema exists.

## Schema

### Identity

| Table              | Purpose                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `profiles`         | Application-level user record, keyed by the auth user id                                        |
| `local_auth_users` | Credentials for the local auth provider only. Empty and unused when Supabase Auth is configured |

### Preferences

`user_preferences` — a weighted `(category, attribute, value)` triple per user.

`category` is nullable so a preference can be global ("I like olive") or scoped
("in clothing I like a boxy fit"). `source` records where it came from
(`explicit`, `behavioral`, `purchase`, `inferred`) and `signal_count` how many
times it has been reinforced, which is what lets weak evidence be held back
until it repeats.

Uniqueness is an expression index, because `category` is nullable and `NULL`
never equals `NULL` in a plain unique constraint:

```sql
create unique index user_preferences_unique
  on user_preferences (user_id, coalesce(category, ''), attribute, value);
```

### Catalogue

The separation that matters most:

```
products              one canonical product          ← what a user sees
  └── merchant_products   one listing per merchant   ← where they buy it
        └── price_history  observations over time    ← what a deal claim rests on
```

A product sold by three merchants is **one** `products` row and **three**
`merchant_products` rows. That is what makes offer comparison and honest price
history possible at all. Identity is decided by `products.match_key`, which
carries a unique constraint so the database itself enforces one row per
identity — see [product-data.md](product-data.md).

Notable columns and constraints:

- `merchant_products.original_price` has a check constraint requiring it to be
  `null` or `>= current_price`. An "original" below the current price is bad
  feed data, not a discount. The normalizer drops such values; the constraint
  stops them arriving by any other route.
- `merchants.allowed_hosts` is the redirect allowlist. A merchant click is only
  ever sent to a host listed here.
- `products.keywords` is a flattened copy of attribute values, maintained by the
  normalizer purely so JSONB attributes can participate in full-text search — a
  generated column cannot walk JSONB.

### Engagement

`user_events` is append-only and is both the analytics record and the input to
behavioural learning. `saved_products`, `product_likes` and `product_rejections`
are separate tables rather than one polymorphic "reactions" table because they
have genuinely different lifecycles and columns.

`affiliate_clicks` carries `converted_at` / `conversion_value` /
`conversion_currency`, unwritten in Phase 1. They exist now so that attaching a
merchant postback later is an `UPDATE`, not a migration on a table with traffic.

## Search

`products.search_vector` is a generated `tsvector` column with weighting:

```
A  canonical_title, brand
B  subcategory, category, keywords
C  description
```

Indexed with GIN. Queried with `websearch_to_tsquery`, which gives users quoted
phrases, `or`, and leading `-` for exclusion without any parsing of our own.

## Indexes

46 indexes, each with a query behind it. The ones worth knowing:

| Index                                       | Serves                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `products_search_vector_idx` (GIN)          | Full-text search                                          |
| `products_attributes_idx` (GIN)             | Colour / fit / material filters on JSONB                  |
| `merchant_products_available_idx` (partial) | Feed candidate generation — indexes only buyable listings |
| `price_history_listing_time_idx`            | Every deal calculation: one listing, most recent N days   |
| `user_events_recent_views_idx` (partial)    | "Recently viewed" on the home page hot path               |

Partial indexes are used where the query always carries the same predicate;
they are smaller and cheaper to maintain than the full equivalents.

## Row-level security

**What RLS is actually protecting here.** Supabase exposes every table over
PostgREST using the _anon_ key, which is public by definition — it ships in the
browser bundle. Without RLS, anyone holding that key can read every user's saved
products and preferences directly, bypassing the application. These policies are
what make publishing the anon key safe.

Policy shape:

- **Catalogue** (`products`, `merchants`, `merchant_products`, `product_variants`,
  `product_images`, `price_history`): public `select`. No insert/update/delete
  policies exist at all — ingestion runs as a trusted role.
- **Per-user tables** (`user_preferences`, `saved_products`, `product_likes`,
  `product_rejections`): full ownership of one's own rows, nothing else.
- **`user_events`, `affiliate_clicks`**: insert and select own rows; no update or
  delete, so the event log stays trustworthy.
- **`local_auth_users`**: RLS enabled with _zero_ policies, plus an explicit
  `revoke`. Password hashes are unreachable by any client role.

Identity comes from `bloom_current_user_id()`, which reads the Supabase JWT
claim or, when Bloom talks to Postgres directly, a per-transaction
`app.user_id` setting. One function covers both paths.

### Defence in depth

Bloom's server connects as a trusted role that RLS does **not** constrain. So
RLS is not the primary server-side control — every repository query additionally
scopes by `user_id` explicitly:

```ts
// lib/preferences/repository.ts
delete from user_preferences where id = $1 and user_id = $2
```

Scoping by `id` alone would be an insecure direct object reference. Neither
layer is trusted to be the only one.

`tests/integration/rls.test.ts` verifies the policies by assuming the
`authenticated` role and attempting cross-user reads, writes and deletes. Those
tests exist because "we enabled RLS" is an unverified claim until something
tries to break it.

## Money

`numeric(12,2)` everywhere. Never `float`. Postgres returns `numeric` as a
string over the wire and from PGlite, so `lib/db/rows.ts` converts explicitly at
the repository boundary. `tests/integration/catalog.test.ts` asserts that prices
arrive as numbers, because this is the kind of bug that produces plausible
nonsense rather than an obvious failure.
