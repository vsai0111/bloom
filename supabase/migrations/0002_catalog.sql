-- ---------------------------------------------------------------------------
-- Bloom 0002 — catalogue: merchants, canonical products, listings, pricing
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------
create table if not exists merchants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  website_url   text not null check (website_url ~ '^https?://'),
  logo_url      text,
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'disabled')),
  -- Hostname allowlist for outbound redirects. A merchant click is only ever
  -- sent to a host listed here, which is what closes the open-redirect hole.
  allowed_hosts text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger merchants_set_updated_at
  before update on merchants
  for each row execute function public.bloom_set_updated_at();

-- ---------------------------------------------------------------------------
-- products — the canonical, merchant-independent product
-- ---------------------------------------------------------------------------
-- The same physical product sold by three merchants is ONE row here and three
-- rows in merchant_products. `match_key` is the deterministic identity used to
-- decide whether an incoming listing is an existing product (see
-- services/normalization/matching.ts).
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  canonical_title  text not null check (length(trim(canonical_title)) > 0),
  description      text,
  brand            text not null,
  category         text not null,
  subcategory      text,
  gender           text,
  -- Normalised descriptive attributes (fit, style, material, ...). Values are
  -- constrained to config/taxonomy.ts by the normalizer before insert. JSONB
  -- because the attribute set legitimately differs per category.
  attributes       jsonb not null default '{}'::jsonb,
  -- Flattened attribute values, maintained by the normalizer purely so they can
  -- participate in full-text search (a generated column cannot walk JSONB).
  keywords         text not null default '',
  match_key        text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on products
  for each row execute function public.bloom_set_updated_at();

-- Weighted full-text search vector. Title and brand rank above taxonomy, which
-- ranks above free-text description.
alter table products
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(canonical_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subcategory, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(keywords, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

create index if not exists products_search_vector_idx on products using gin (search_vector);
create index if not exists products_category_idx on products (category, subcategory);
create index if not exists products_brand_idx on products (lower(brand));
create index if not exists products_attributes_idx on products using gin (attributes);

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------
create table if not exists product_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products (id) on delete cascade,
  sku                text,
  size               text,
  color              text,
  variant_attributes jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists product_variants_unique
  on product_variants (product_id, coalesce(size, ''), coalesce(color, ''));

create index if not exists product_variants_product_idx on product_variants (product_id);

create trigger product_variants_set_updated_at
  before update on product_variants
  for each row execute function public.bloom_set_updated_at();

-- ---------------------------------------------------------------------------
-- merchant_products — one merchant's listing of a canonical product
-- ---------------------------------------------------------------------------
create table if not exists merchant_products (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         uuid not null references merchants (id) on delete cascade,
  product_id          uuid not null references products (id) on delete cascade,
  external_product_id text not null,
  title               text not null,
  product_url         text not null check (product_url ~ '^https?://'),
  affiliate_url       text check (affiliate_url ~ '^https?://'),
  image_url           text,
  availability        text not null default 'in_stock'
                        check (availability in ('in_stock', 'low_stock', 'out_of_stock', 'discontinued')),
  current_price       numeric(12, 2) not null check (current_price >= 0),
  original_price      numeric(12, 2) check (original_price >= 0),
  currency            char(3) not null default 'USD',
  metadata            jsonb not null default '{}'::jsonb,
  last_synced_at      timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A listing is unique per merchant.
  constraint merchant_products_external_unique unique (merchant_id, external_product_id),

  -- An "original price" below the current price is bad feed data, not a deal.
  -- The normalizer drops such values; this constraint stops them reaching the
  -- deal engine by any other route.
  constraint merchant_products_original_price_sane
    check (original_price is null or original_price >= current_price)
);

create index if not exists merchant_products_product_idx on merchant_products (product_id);
create index if not exists merchant_products_merchant_idx on merchant_products (merchant_id);
create index if not exists merchant_products_price_idx on merchant_products (current_price);
-- Partial index: feed queries almost always want buyable listings only.
create index if not exists merchant_products_available_idx
  on merchant_products (product_id, current_price)
  where availability in ('in_stock', 'low_stock');

create trigger merchant_products_set_updated_at
  before update on merchant_products
  for each row execute function public.bloom_set_updated_at();

-- ---------------------------------------------------------------------------
-- product_images
-- ---------------------------------------------------------------------------
create table if not exists product_images (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid references products (id) on delete cascade,
  merchant_product_id uuid references merchant_products (id) on delete cascade,
  url                 text not null,
  alt_text            text,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  constraint product_images_owner check (product_id is not null or merchant_product_id is not null)
);

create index if not exists product_images_product_idx on product_images (product_id, position);

-- ---------------------------------------------------------------------------
-- price_history — the evidence base for every deal claim
-- ---------------------------------------------------------------------------
create table if not exists price_history (
  id                  uuid primary key default gen_random_uuid(),
  merchant_product_id uuid not null references merchant_products (id) on delete cascade,
  price               numeric(12, 2) not null check (price >= 0),
  original_price      numeric(12, 2) check (original_price >= 0),
  currency            char(3) not null default 'USD',
  recorded_at         timestamptz not null default now(),
  source              text not null default 'sync'
                        check (source in ('sync', 'seed', 'manual', 'import'))
);

-- Every deal calculation is "this listing, most recent N days", so lead with the
-- listing and order by time descending.
create index if not exists price_history_listing_time_idx
  on price_history (merchant_product_id, recorded_at desc);
