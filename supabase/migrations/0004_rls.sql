-- ---------------------------------------------------------------------------
-- Bloom 0004 — row level security
-- ---------------------------------------------------------------------------
-- Threat model this addresses:
--
--   Supabase exposes every table over PostgREST using the *anon* key, which is
--   public by definition — it ships in the browser bundle. Without RLS, anyone
--   holding that key can read every user's saved products and preferences
--   directly, bypassing the application entirely. These policies are what make
--   the anon key safe to publish.
--
--   Bloom's own server code connects as the table owner (or Supabase's
--   service_role), which by design is not subject to these policies. Server-side
--   authorisation is therefore enforced a second time, explicitly, by scoping
--   every query with `user_id = $currentUser` in lib/db/repositories. Neither
--   layer is trusted to be the only one. See docs/database.md.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Public catalogue — readable by anyone, writable only by trusted server roles
-- ---------------------------------------------------------------------------
alter table merchants          enable row level security;
alter table products           enable row level security;
alter table product_variants   enable row level security;
alter table merchant_products  enable row level security;
alter table product_images     enable row level security;
alter table price_history      enable row level security;

drop policy if exists merchants_public_read on merchants;
create policy merchants_public_read on merchants
  for select to anon, authenticated using (status = 'active');

drop policy if exists products_public_read on products;
create policy products_public_read on products
  for select to anon, authenticated using (true);

drop policy if exists product_variants_public_read on product_variants;
create policy product_variants_public_read on product_variants
  for select to anon, authenticated using (true);

drop policy if exists merchant_products_public_read on merchant_products;
create policy merchant_products_public_read on merchant_products
  for select to anon, authenticated using (true);

drop policy if exists product_images_public_read on product_images;
create policy product_images_public_read on product_images
  for select to anon, authenticated using (true);

-- Price history is public so the product page can render an honest chart.
drop policy if exists price_history_public_read on price_history;
create policy price_history_public_read on price_history
  for select to anon, authenticated using (true);

-- No insert/update/delete policies exist for the catalogue: ingestion runs as a
-- trusted role only.

-- ---------------------------------------------------------------------------
-- profiles — a user sees and edits only their own
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles
  for select to authenticated using (id = public.bloom_current_user_id());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update to authenticated
  using (id = public.bloom_current_user_id())
  with check (id = public.bloom_current_user_id());

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert to authenticated with check (id = public.bloom_current_user_id());

-- ---------------------------------------------------------------------------
-- Per-user tables — full ownership of one's own rows, nothing else
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_preferences',
    'saved_products',
    'product_likes',
    'product_rejections'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (user_id = public.bloom_current_user_id())
         with check (user_id = public.bloom_current_user_id())',
      t || '_own', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- user_events — append-only from the client's point of view
-- ---------------------------------------------------------------------------
-- A user may record their own events and read them back, but may never edit or
-- delete them: the event log has to stay trustworthy to be worth measuring.
alter table user_events enable row level security;

drop policy if exists user_events_insert_own on user_events;
create policy user_events_insert_own on user_events
  for insert to authenticated with check (user_id = public.bloom_current_user_id());

drop policy if exists user_events_select_own on user_events;
create policy user_events_select_own on user_events
  for select to authenticated using (user_id = public.bloom_current_user_id());

-- ---------------------------------------------------------------------------
-- affiliate_clicks — user may create and read their own; never mutate
-- ---------------------------------------------------------------------------
alter table affiliate_clicks enable row level security;

drop policy if exists affiliate_clicks_insert_own on affiliate_clicks;
create policy affiliate_clicks_insert_own on affiliate_clicks
  for insert to authenticated with check (user_id = public.bloom_current_user_id());

drop policy if exists affiliate_clicks_select_own on affiliate_clicks;
create policy affiliate_clicks_select_own on affiliate_clicks
  for select to authenticated using (user_id = public.bloom_current_user_id());

-- ---------------------------------------------------------------------------
-- local_auth_users — no policies, ever
-- ---------------------------------------------------------------------------
-- RLS on with zero policies denies every non-superuser role outright. Password
-- hashes are reachable only by trusted server code.
alter table local_auth_users enable row level security;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- RLS filters rows; grants decide whether a role may touch the table at all.
-- Both are required.
grant usage on schema public to anon, authenticated;

grant select on merchants, products, product_variants, merchant_products,
                product_images, price_history to anon, authenticated;

grant select, insert, update, delete on
  user_preferences, saved_products, product_likes, product_rejections
  to authenticated;

grant select, update, insert on profiles to authenticated;
grant select, insert on user_events to authenticated;
grant select, insert on affiliate_clicks to authenticated;

-- Explicitly withhold everything on the credential table.
revoke all on local_auth_users from anon, authenticated;

grant execute on function public.bloom_current_user_id() to anon, authenticated;
