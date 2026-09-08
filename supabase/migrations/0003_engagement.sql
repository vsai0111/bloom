-- ---------------------------------------------------------------------------
-- Bloom 0003 — engagement: events, explicit actions, affiliate clicks
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- user_events — the behavioural signal log
-- ---------------------------------------------------------------------------
-- Append-only. This is both the analytics source of truth (so the funnel can be
-- measured without depending on a third party) and the input to behavioural
-- preference learning. `user_id` is nullable so pre-signup funnel steps
-- (landing_view, signup_started) can still be attributed to a session.
create table if not exists user_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references profiles (id) on delete cascade,
  session_id          text,
  event_type          text not null,
  product_id          uuid references products (id) on delete set null,
  merchant_product_id uuid references merchant_products (id) on delete set null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- "What has this user done lately" — recently viewed, learning passes.
create index if not exists user_events_user_time_idx
  on user_events (user_id, created_at desc);
-- "How many users reached step X" — funnel aggregation.
create index if not exists user_events_type_time_idx
  on user_events (event_type, created_at desc);
create index if not exists user_events_product_idx
  on user_events (product_id)
  where product_id is not null;
-- Narrow index for the recently-viewed lookup, which is on the hot home path.
create index if not exists user_events_recent_views_idx
  on user_events (user_id, created_at desc)
  where event_type = 'product_view';

-- ---------------------------------------------------------------------------
-- saved_products / product_likes / product_rejections
-- ---------------------------------------------------------------------------
-- Kept as three tables rather than one polymorphic "reactions" table: they have
-- genuinely different lifecycles (saves are a user-visible collection, likes are
-- a ranking signal, rejections are a suppression list) and different columns.
create table if not exists saved_products (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  -- Price at the moment of saving, so "cheaper than when you saved it" is a
  -- fact about this user's timeline rather than a guess from global history.
  price_at_save   numeric(12, 2),
  currency_at_save char(3),
  created_at timestamptz not null default now(),
  constraint saved_products_unique unique (user_id, product_id)
);

create index if not exists saved_products_user_idx on saved_products (user_id, created_at desc);

create table if not exists product_likes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint product_likes_unique unique (user_id, product_id)
);

create index if not exists product_likes_user_idx on product_likes (user_id, created_at desc);

create table if not exists product_rejections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  reason     text check (reason is null or reason in
                ('not_my_style', 'too_expensive', 'wrong_size', 'already_own', 'disliked_brand', 'other')),
  created_at timestamptz not null default now(),
  constraint product_rejections_unique unique (user_id, product_id)
);

create index if not exists product_rejections_user_idx on product_rejections (user_id);

-- ---------------------------------------------------------------------------
-- affiliate_clicks — the commercial event
-- ---------------------------------------------------------------------------
-- Recorded immediately before the outbound redirect. The conversion columns are
-- nullable and unwritten in Phase 1: they exist so that attaching a merchant
-- postback later is an UPDATE, not a schema migration on a table with traffic.
create table if not exists affiliate_clicks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references profiles (id) on delete set null,
  merchant_id         uuid not null references merchants (id) on delete cascade,
  product_id          uuid references products (id) on delete set null,
  merchant_product_id uuid references merchant_products (id) on delete set null,
  -- The URL the user was actually sent to, after allowlist validation.
  destination_url     text not null,
  clicked_at          timestamptz not null default now(),
  metadata            jsonb not null default '{}'::jsonb,

  -- Reserved for Phase 2 conversion tracking. Never written in Phase 1.
  converted_at        timestamptz,
  conversion_value    numeric(12, 2) check (conversion_value is null or conversion_value >= 0),
  conversion_currency char(3)
);

create index if not exists affiliate_clicks_user_idx on affiliate_clicks (user_id, clicked_at desc);
create index if not exists affiliate_clicks_merchant_idx on affiliate_clicks (merchant_id, clicked_at desc);
create index if not exists affiliate_clicks_product_idx on affiliate_clicks (product_id);
