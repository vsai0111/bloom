import 'server-only'
import {
  BEHAVIORAL_PREFERENCE_THRESHOLD,
  PREFERENCE_SOURCE_WEIGHTS,
  PREFERENCE_WEIGHT_BOUNDS,
  SIGNAL_WEIGHT_DELTAS,
  type LearningSignal,
  type PreferenceSource,
} from '@/config/scoring'
import { PREFERENCE_ATTRIBUTES, scopeForAttribute } from '@/config/taxonomy'
import type { Db } from '@/lib/db/types'
import { isoDate, num, str, strOrNull } from '@/lib/db/rows'
import { clamp } from '@/lib/utils/number'
import type { PreferenceInput, UserPreference } from '@/types/user'

/**
 * Preference storage and the behavioural learning rule.
 *
 * Preferences are the product's core state. Two properties matter more than
 * sophistication:
 *
 *   1. Explainability. A user must be able to look at their preferences page,
 *      recognise every row, and delete anything wrong. That rules out opaque
 *      embeddings for Phase 1.
 *   2. Explicit beats inferred. Something a user actually told us outranks
 *      something we guessed from a click, and a behavioural signal never
 *      overwrites an explicit statement.
 */

interface PreferenceRow {
  id: string
  user_id: string
  category: string | null
  attribute: string
  value: string
  weight: unknown
  source: string
  signal_count: unknown
  created_at: unknown
  updated_at: unknown
}

function toPreference(row: PreferenceRow): UserPreference {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    category: strOrNull(row.category),
    attribute: str(row.attribute),
    value: str(row.value),
    weight: num(row.weight),
    source: str(row.source) as PreferenceSource,
    signalCount: num(row.signal_count, 1),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

/** Reject attributes outside the controlled vocabulary before they reach SQL. */
export function isValidPreferenceAttribute(attribute: string): boolean {
  return (PREFERENCE_ATTRIBUTES as readonly string[]).includes(attribute)
}

export async function listPreferences(db: Db, userId: string): Promise<UserPreference[]> {
  const rows = await db.query<PreferenceRow>(
    `select id, user_id, category, attribute, value, weight, source, signal_count,
            created_at, updated_at
       from user_preferences
      where user_id = $1
      order by weight desc, attribute asc, value asc`,
    [userId],
  )
  return rows.map(toPreference)
}

/**
 * Add or update an explicit preference.
 *
 * Explicit statements are authoritative: they overwrite whatever weight
 * behavioural learning had arrived at, and reset the source.
 */
export async function upsertPreference(
  db: Db,
  userId: string,
  input: PreferenceInput,
): Promise<UserPreference | null> {
  if (!isValidPreferenceAttribute(input.attribute)) return null

  const value = input.value.trim().toLowerCase()
  if (!value || value.length > 80) return null

  const source: PreferenceSource = input.source ?? 'explicit'
  const weight = clamp(
    input.weight ?? PREFERENCE_SOURCE_WEIGHTS[source],
    PREFERENCE_WEIGHT_BOUNDS.min,
    PREFERENCE_WEIGHT_BOUNDS.max,
  )

  const rows = await db.query<PreferenceRow>(
    `insert into user_preferences (user_id, category, attribute, value, weight, source, signal_count)
     values ($1, $2, $3, $4, $5, $6, 1)
     on conflict (user_id, coalesce(category, ''), attribute, value)
     do update set weight = excluded.weight,
                   source = excluded.source,
                   signal_count = user_preferences.signal_count + 1,
                   updated_at = now()
     returning id, user_id, category, attribute, value, weight, source, signal_count,
               created_at, updated_at`,
    [userId, input.category ?? null, input.attribute, value, weight, source],
  )

  return rows[0] ? toPreference(rows[0]) : null
}

export async function removePreference(
  db: Db,
  userId: string,
  preferenceId: string,
): Promise<boolean> {
  // Scoped by user_id as well as id: an id alone must never be enough to delete
  // another user's row (insecure direct object reference).
  const rows = await db.query<{ id: string }>(
    `delete from user_preferences where id = $1 and user_id = $2 returning id`,
    [preferenceId, userId],
  )
  return rows.length > 0
}

export async function setPreferenceWeight(
  db: Db,
  userId: string,
  preferenceId: string,
  weight: number,
): Promise<boolean> {
  const bounded = clamp(weight, PREFERENCE_WEIGHT_BOUNDS.min, PREFERENCE_WEIGHT_BOUNDS.max)
  const rows = await db.query<{ id: string }>(
    `update user_preferences
        set weight = $3, source = 'explicit', updated_at = now()
      where id = $1 and user_id = $2
      returning id`,
    [preferenceId, userId, bounded],
  )
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Behavioural learning
// ---------------------------------------------------------------------------

/** The product facts a behavioural signal can teach us something about. */
export interface LearnableProduct {
  category: string
  subcategory: string | null
  brand: string
  attributes: Record<string, string | undefined>
  priceBand?: string
}

/**
 * Update preferences from one behavioural signal.
 *
 * The rule, deliberately simple enough to explain in a sentence: liking or
 * saving a product nudges up the weight of each attribute that product has;
 * rejecting it nudges them down. A preference only comes into existence once
 * the same attribute has been reinforced `BEHAVIORAL_PREFERENCE_THRESHOLD`
 * times, so a single curious click does not become a stated taste.
 *
 * Explicit preferences are never overwritten here — only their weight is
 * adjusted, and their source stays `explicit`.
 */
export async function learnFromSignal(
  db: Db,
  userId: string,
  signal: LearningSignal,
  product: LearnableProduct,
): Promise<void> {
  const delta = SIGNAL_WEIGHT_DELTAS[signal]
  if (delta === undefined) return

  const facts: Array<{ attribute: string; value: string; category: string | null }> = []

  // Scope is decided by `scopeForAttribute`, the same rule onboarding uses, so a
  // learned preference lands on the same row as an explicitly stated one rather
  // than creating a category-scoped near-duplicate beside it.
  const push = (attribute: string, value: string | null | undefined) => {
    if (value && isValidPreferenceAttribute(attribute)) {
      facts.push({
        attribute,
        value: value.toLowerCase(),
        category: scopeForAttribute(attribute, product.category),
      })
    }
  }

  push('brand', product.brand)
  push('subcategory', product.subcategory)
  push('color', product.attributes.color)
  push('fit', product.attributes.fit)
  push('style', product.attributes.style)
  push('material', product.attributes.material)
  push('price_band', product.priceBand)

  if (facts.length === 0) return

  for (const fact of facts) {
    await db.query(
      `insert into user_preferences (user_id, category, attribute, value, weight, source, signal_count)
       values ($1, $2, $3, $4, $5, 'behavioral', 1)
       on conflict (user_id, coalesce(category, ''), attribute, value)
       do update set
         weight = least($7::numeric, greatest($6::numeric,
                    user_preferences.weight + $8::numeric)),
         signal_count = user_preferences.signal_count + 1,
         updated_at = now()`,
      [
        userId,
        fact.category,
        fact.attribute,
        fact.value,
        // A brand-new behavioural preference starts low; it has to earn weight.
        clamp(
          PREFERENCE_SOURCE_WEIGHTS.behavioral * 0.5 + delta,
          PREFERENCE_WEIGHT_BOUNDS.min,
          PREFERENCE_WEIGHT_BOUNDS.max,
        ),
        PREFERENCE_WEIGHT_BOUNDS.min,
        PREFERENCE_WEIGHT_BOUNDS.max,
        delta,
      ],
    )
  }

  // Drop behavioural preferences that repeated rejection has pushed to the floor.
  await db.query(
    `delete from user_preferences
      where user_id = $1 and source = 'behavioral'
        and weight <= $2 and signal_count >= $3`,
    [userId, PREFERENCE_WEIGHT_BOUNDS.min, BEHAVIORAL_PREFERENCE_THRESHOLD],
  )
}

/**
 * Preferences that are strong enough to act on.
 *
 * Behavioural preferences must have repeated before they influence ranking;
 * explicit ones count immediately.
 */
export async function listActivePreferences(db: Db, userId: string): Promise<UserPreference[]> {
  const rows = await db.query<PreferenceRow>(
    `select id, user_id, category, attribute, value, weight, source, signal_count,
            created_at, updated_at
       from user_preferences
      where user_id = $1
        and (source <> 'behavioral' or signal_count >= $2)
      order by weight desc`,
    [userId, BEHAVIORAL_PREFERENCE_THRESHOLD],
  )
  return rows.map(toPreference)
}

export async function countPreferences(db: Db, userId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from user_preferences where user_id = $1`,
    [userId],
  )
  return num(rows[0]?.n, 0)
}
