import 'server-only'
import { priceBandFor } from '@/config/taxonomy'
import type { Db } from '@/lib/db/types'
import { isoDate, json, num, numOrNull, str, strOrNull } from '@/lib/db/rows'
import { learnFromSignal, type LearnableProduct } from '@/lib/preferences/repository'
import { loadProductSummaries } from '@/lib/products/repository'
import type { ProductAttributes } from '@/types/catalog'
import type { ProductSummary } from '@/types/discovery'

/**
 * Explicit user actions on products: save, like, reject.
 *
 * Each action does three things atomically from the caller's point of view:
 * it records the state, it emits the behavioural signal that updates
 * preferences, and it leaves an event for analytics. Keeping that together is
 * what makes the "action improves future recommendations" loop actually close
 * rather than being an aspiration.
 */

export type RejectionReason =
  'not_my_style' | 'too_expensive' | 'wrong_size' | 'already_own' | 'disliked_brand' | 'other'

export interface ProductState {
  saved: boolean
  liked: boolean
  rejected: boolean
}

/** Current save/like/reject state for a set of products, in one query. */
export async function loadProductStates(
  db: Db,
  userId: string,
  productIds: readonly string[],
): Promise<Map<string, ProductState>> {
  const states = new Map<string, ProductState>()
  if (productIds.length === 0) return states

  const ids = [...productIds]
  const rows = await db.query<{ product_id: string; kind: string }>(
    `select product_id, 'saved' as kind from saved_products
       where user_id = $1 and product_id = any($2::uuid[])
     union all
     select product_id, 'liked' from product_likes
       where user_id = $1 and product_id = any($2::uuid[])
     union all
     select product_id, 'rejected' from product_rejections
       where user_id = $1 and product_id = any($2::uuid[])`,
    [userId, ids],
  )

  for (const id of ids) states.set(id, { saved: false, liked: false, rejected: false })

  for (const row of rows) {
    const state = states.get(str(row.product_id))
    if (!state) continue
    if (row.kind === 'saved') state.saved = true
    if (row.kind === 'liked') state.liked = true
    if (row.kind === 'rejected') state.rejected = true
  }

  return states
}

/** Facts about a product that behavioural learning can use. */
async function loadLearnable(db: Db, productId: string): Promise<LearnableProduct | null> {
  const rows = await db.query<{
    category: string
    subcategory: string | null
    brand: string
    attributes: unknown
    price: unknown
  }>(
    `select p.category, p.subcategory, p.brand, p.attributes,
            min(mp.current_price) as price
       from products p
       left join merchant_products mp on mp.product_id = p.id
      where p.id = $1
      group by p.id, p.category, p.subcategory, p.brand, p.attributes`,
    [productId],
  )

  const row = rows[0]
  if (!row) return null

  const price = numOrNull(row.price)

  return {
    category: str(row.category),
    subcategory: strOrNull(row.subcategory),
    brand: str(row.brand),
    attributes: json<ProductAttributes>(row.attributes, {}) as Record<string, string | undefined>,
    priceBand: price === null ? undefined : priceBandFor(price),
  }
}

/** Toggle saved state. Returns the state after the toggle. */
export async function toggleSave(
  db: Db,
  userId: string,
  productId: string,
): Promise<{ saved: boolean }> {
  const removed = await db.query<{ id: string }>(
    `delete from saved_products where user_id = $1 and product_id = $2 returning id`,
    [userId, productId],
  )

  if (removed.length > 0) return { saved: false }

  // Capture the price at save time so "cheaper than when you saved it" is a
  // fact about this user's own timeline, not a guess from global history.
  await db.query(
    `insert into saved_products (user_id, product_id, price_at_save, currency_at_save)
     select $1, $2, mp.current_price, mp.currency
       from merchant_products mp
      where mp.product_id = $2
      order by (mp.availability in ('in_stock','low_stock')) desc, mp.current_price asc
      limit 1
     on conflict (user_id, product_id) do nothing`,
    [userId, productId],
  )

  const learnable = await loadLearnable(db, productId)
  if (learnable) await learnFromSignal(db, userId, 'product_save', learnable)

  return { saved: true }
}

export async function toggleLike(
  db: Db,
  userId: string,
  productId: string,
): Promise<{ liked: boolean }> {
  const removed = await db.query<{ id: string }>(
    `delete from product_likes where user_id = $1 and product_id = $2 returning id`,
    [userId, productId],
  )
  if (removed.length > 0) return { liked: false }

  await db.query(
    `insert into product_likes (user_id, product_id) values ($1, $2)
     on conflict (user_id, product_id) do nothing`,
    [userId, productId],
  )

  const learnable = await loadLearnable(db, productId)
  if (learnable) await learnFromSignal(db, userId, 'product_like', learnable)

  return { liked: true }
}

/**
 * Mark a product as not interesting.
 *
 * Rejection both suppresses the product from future feeds and pushes down the
 * weight of the attributes it carried, so "not for me" actually changes what
 * the user sees next rather than only hiding one item.
 */
export async function rejectProduct(
  db: Db,
  userId: string,
  productId: string,
  reason?: RejectionReason,
): Promise<void> {
  await db.query(
    `insert into product_rejections (user_id, product_id, reason) values ($1, $2, $3)
     on conflict (user_id, product_id) do update set reason = excluded.reason`,
    [userId, productId, reason ?? null],
  )

  // A rejected product should not stay in the user's saved collection.
  await db.query(`delete from saved_products where user_id = $1 and product_id = $2`, [
    userId,
    productId,
  ])
  await db.query(`delete from product_likes where user_id = $1 and product_id = $2`, [
    userId,
    productId,
  ])

  const learnable = await loadLearnable(db, productId)
  if (learnable) await learnFromSignal(db, userId, 'product_reject', learnable)
}

export async function undoRejection(db: Db, userId: string, productId: string): Promise<void> {
  await db.query(`delete from product_rejections where user_id = $1 and product_id = $2`, [
    userId,
    productId,
  ])
}

/** Record that a user looked at a product, and learn weakly from it. */
export async function recordProductView(db: Db, userId: string, productId: string): Promise<void> {
  const learnable = await loadLearnable(db, productId)
  if (learnable) await learnFromSignal(db, userId, 'product_view', learnable)
}

export interface SavedProductEntry {
  summary: ProductSummary
  savedAt: string
  priceAtSave: number | null
  /** Change since saving. Negative means it got cheaper. */
  priceChange: number | null
}

/**
 * The user's saved collection, with the price movement since each save.
 *
 * This is the one place Bloom can make a genuinely personal price claim —
 * it compares against what the user themselves saw, not a market average.
 */
export async function listSavedProducts(
  db: Db,
  userId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<SavedProductEntry[]> {
  const rows = await db.query<{
    product_id: string
    created_at: unknown
    price_at_save: unknown
  }>(
    `select product_id, created_at, price_at_save
       from saved_products
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, options.limit ?? 100],
  )

  if (rows.length === 0) return []

  const summaries = await loadProductSummaries(
    db,
    rows.map((row) => str(row.product_id)),
    { now: options.now },
  )
  const byId = new Map(summaries.map((summary) => [summary.product.id, summary]))

  const entries: SavedProductEntry[] = []

  for (const row of rows) {
    const summary = byId.get(str(row.product_id))
    if (!summary) continue

    const priceAtSave = numOrNull(row.price_at_save)

    entries.push({
      summary,
      savedAt: isoDate(row.created_at),
      priceAtSave,
      priceChange:
        priceAtSave === null
          ? null
          : Math.round((summary.offer.currentPrice - priceAtSave) * 100) / 100,
    })
  }

  return entries
}

export async function countSaved(db: Db, userId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from saved_products where user_id = $1`,
    [userId],
  )
  return num(rows[0]?.n, 0)
}
