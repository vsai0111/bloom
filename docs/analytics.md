# Analytics

## Where events live

Bloom's own `user_events` table is the source of truth. PostHog, if configured,
is a mirror for exploration — never the record.

Three reasons for that: the questions below can be answered with SQL and no
vendor account; the behavioural learning loop reads the same events it writes;
and the funnel survives changing analytics vendor.

**PostHog is not currently configured** — no credentials have been provisioned.
`lib/analytics/client.ts` is a no-op in that state and makes no network request.
Set `NEXT_PUBLIC_POSTHOG_KEY` to enable it.

## Event taxonomy

| Event                                         | Recorded where      | Auth      |
| --------------------------------------------- | ------------------- | --------- |
| `landing_view`                                | Landing page render | anonymous |
| `signup_started` / `signup_completed`         | Sign-up action      | anonymous |
| `signin_completed`                            | Sign-in action      | user      |
| `onboarding_started` / `onboarding_completed` | Onboarding          | user      |
| `preference_added` / `preference_removed`     | Preference actions  | user      |
| `home_view`                                   | Home page render    | user      |
| `recommendation_view`                         | Home page render    | user      |
| `search_started` / `search_completed`         | Search page         | user      |
| `product_viewed`                              | Product page render | user      |
| `product_liked` / `product_unliked`           | Action              | user      |
| `product_saved` / `product_unsaved`           | Action              | user      |
| `product_rejected`                            | Action              | user      |
| `merchant_clicked`                            | `/go/[id]` route    | either    |

Every row carries `user_id`, `session_id`, `product_id`,
`merchant_product_id`, `metadata` (JSONB) and `created_at` as applicable.

`affiliate_clicks` separately records the commercial event with the destination
URL and the price at click time.

## Privacy

- `session_id` is an opaque random UUID in an HttpOnly cookie. It exists so
  pre-signup steps can be joined to the account that results — which is the only
  way signup conversion is measurable at all. No fingerprinting, no cross-site
  tracking.
- Event metadata is restricted to primitives and shallow string arrays, and
  capped at 4KB, so an event row cannot become arbitrary storage.
- The structured logger redacts `password`, `email`, tokens, cookies and keys.
- Recording an event **never throws**. A lost data point is acceptable; a broken
  save button is not.
- Events requiring a user are dropped rather than stored with a null owner. Only
  the four pre-signup events are permitted anonymously.

## The questions this must answer

### How many users complete onboarding?

```sql
select
  count(*) filter (where event_type = 'signup_completed')      as signed_up,
  count(*) filter (where event_type = 'onboarding_started')    as started,
  count(*) filter (where event_type = 'onboarding_completed')  as completed,
  round(100.0 * count(*) filter (where event_type = 'onboarding_completed')
        / nullif(count(*) filter (where event_type = 'signup_completed'), 0), 1) as pct
from user_events;
```

### Which preferences are most common?

```sql
select attribute, value, count(*) as users, round(avg(weight), 2) as avg_weight
from user_preferences
where source = 'explicit'
group by attribute, value
order by users desc
limit 25;
```

### Which recommendations get clicked?

```sql
select p.brand, p.canonical_title,
       count(*) filter (where e.event_type = 'product_viewed')   as views,
       count(*) filter (where e.event_type = 'merchant_clicked') as clicks
from user_events e
join products p on p.id = e.product_id
group by p.id, p.brand, p.canonical_title
having count(*) filter (where e.event_type = 'product_viewed') > 0
order by clicks desc nulls last
limit 25;
```

### Which products get saved?

```sql
select p.brand, p.canonical_title, count(*) as saves
from saved_products s
join products p on p.id = s.product_id
group by p.id, p.brand, p.canonical_title
order by saves desc
limit 25;
```

### Which users return?

```sql
select user_id,
       count(distinct date_trunc('day', created_at)) as active_days,
       min(created_at) as first_seen,
       max(created_at) as last_seen
from user_events
where user_id is not null
group by user_id
having count(distinct date_trunc('day', created_at)) > 1
order by active_days desc;
```

### How often do users click through to merchants?

```sql
select date_trunc('week', clicked_at) as week,
       count(*) as clicks,
       count(distinct user_id) as users
from affiliate_clicks
group by 1
order by 1 desc;
```

### Which recommendation signals correlate with engagement?

Every `product_viewed` event stores the `matchScore` and `dealScore` the product
had at render time, which is what makes this answerable at all:

```sql
select width_bucket((metadata->>'matchScore')::numeric, 0, 1, 5) as match_bucket,
       count(*) as views,
       count(*) filter (
         where exists (
           select 1 from user_events c
           where c.user_id = e.user_id
             and c.product_id = e.product_id
             and c.event_type = 'merchant_clicked'
         )
       ) as led_to_click
from user_events e
where event_type = 'product_viewed' and metadata ? 'matchScore'
group by 1
order by 1;
```

That query is the one that actually tests the product hypothesis: if a higher
preference-match score does not correlate with click-through, the ranking model
is not earning its place.

## The funnel that matters

```
landing_view
     ↓  signup conversion
signup_completed
     ↓  activation
onboarding_completed
     ↓  engagement
home_view → product_viewed
     ↓  intent
product_saved / product_liked
     ↓  commercial outcome
merchant_clicked
     ↓  retention
return visit on a later day
```

Conversion is not measurable in Phase 1 — Bloom does not own checkout. The
`affiliate_clicks` conversion columns exist for when merchant postbacks are
available.
