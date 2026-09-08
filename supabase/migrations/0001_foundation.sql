-- ---------------------------------------------------------------------------
-- Bloom 0001 — foundation: helpers, identity, preferences
-- ---------------------------------------------------------------------------
-- These migrations are written to run unchanged on Supabase Postgres and on the
-- embedded PGlite instance used for development and tests. Anything that exists
-- only on Supabase (the `auth` schema, the `anon`/`authenticated` roles) is
-- created or skipped conditionally rather than assumed.
-- ---------------------------------------------------------------------------

-- Supabase provisions these roles; a bare Postgres does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Identity of the current request
-- ---------------------------------------------------------------------------
-- On Supabase the user id arrives in the request JWT. When Bloom talks to
-- Postgres directly it is set per-transaction via `set_config('app.user_id', …)`
-- (see lib/db/index.ts withUserContext). One function covers both so RLS
-- policies never need to know which path they are on.
create or replace function public.bloom_current_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.user_id', true), '')::uuid,
    nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
  );
$$;

create or replace function public.bloom_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — application-level user data, keyed by the auth user id
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id                    uuid primary key,
  display_name          text not null check (length(trim(display_name)) between 1 and 80),
  onboarding_completed  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.bloom_set_updated_at();

-- Tie profiles to Supabase Auth when that schema is present.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) and not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- local_auth_users — credentials for the local auth provider only
-- ---------------------------------------------------------------------------
-- Used when Supabase Auth is not configured, so the product is fully usable in
-- development without external credentials. Unused (and empty) on Supabase,
-- where auth.users is the source of truth. Never readable via RLS by anyone.
create table if not exists local_auth_users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists local_auth_users_email_key
  on local_auth_users (lower(email));

create trigger local_auth_users_set_updated_at
  before update on local_auth_users
  for each row execute function public.bloom_set_updated_at();

-- ---------------------------------------------------------------------------
-- user_preferences — the core personalisation input
-- ---------------------------------------------------------------------------
-- A preference is a weighted (category, attribute, value) triple. `category` is
-- nullable so a preference can be global ("I like the colour olive") or scoped
-- ("in clothing, I like a boxy fit").
create table if not exists user_preferences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  category      text,
  attribute     text not null,
  value         text not null,
  weight        numeric(4, 3) not null default 0.500 check (weight >= 0 and weight <= 1),
  source        text not null check (source in ('explicit', 'behavioral', 'purchase', 'inferred')),
  -- How many signals contributed. Lets weak evidence be held back until it repeats.
  signal_count  integer not null default 1 check (signal_count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per distinct preference per user; upserts target this index.
create unique index if not exists user_preferences_unique
  on user_preferences (user_id, coalesce(category, ''), attribute, value);

create index if not exists user_preferences_user_attr
  on user_preferences (user_id, attribute);

create trigger user_preferences_set_updated_at
  before update on user_preferences
  for each row execute function public.bloom_set_updated_at();
