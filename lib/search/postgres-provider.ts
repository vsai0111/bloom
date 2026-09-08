import 'server-only'
import { PAGE_SIZE } from '@/config/app'
import { CATEGORY_LABELS, type Category } from '@/config/taxonomy'
import type { Db } from '@/lib/db/types'
import { num, str } from '@/lib/db/rows'
import { loadProductSummaries } from '@/lib/products/repository'
import type { SearchFacetValue, SearchQuery, SearchResult, SearchSort } from '@/types/discovery'
import type { SearchProvider } from './types'

/**
 * PostgreSQL-backed search.
 *
 * Uses the weighted `search_vector` generated column on `products` (title and
 * brand above taxonomy, above description) with a GIN index, and
 * `websearch_to_tsquery` so ordinary search-box syntax — quoted phrases, `or`,
 * leading `-` to exclude — behaves the way users expect.
 *
 * SQL injection: the query *text* is composed only from constants and from
 * closed unions (an allow-listed sort key, a fixed facet column name). Every
 * user-supplied value, the search string included, is bound as a parameter.
 */

/**
 * Whitelisted ORDER BY clauses, over columns of the `matched` CTE.
 * A sort key from the request never reaches SQL as free text.
 */
const SORT_SQL: Record<Exclude<SearchSort, 'deal_score'>, string> = {
  relevance: 'rank desc, created_at desc, id asc',
  price_asc: 'current_price asc, id asc',
  price_desc: 'current_price desc, id asc',
  discount: 'discount_pct desc nulls last, current_price asc, id asc',
  newest: 'created_at desc, id asc',
}

const MAX_PAGE_SIZE = 60

/**
 * Cap for the deal-score sort.
 *
 * A true deal score depends on price history and is computed in TypeScript, so
 * it cannot be an ORDER BY. Rather than sort by a discount proxy and mislabel
 * it, that sort loads up to this many matches, scores them properly, and
 * paginates the result. Beyond this cap the ordering would be approximate — at
 * Phase 1 catalogue size it never is.
 */
const DEAL_SORT_CANDIDATE_CAP = 400

interface BuiltQuery {
  cte: string
  params: unknown[]
}

export class PostgresSearchProvider implements SearchProvider {
  readonly id = 'postgres'

  constructor(private readonly db: Db) {}

  /**
   * Build the shared CTE: best offer per product, then the filtered match set.
   * Returns the SQL prefix and the parameters it consumed.
   */
  private build(query: SearchQuery): BuiltQuery & { hasText: boolean } {
    const params: unknown[] = []
    const conditions: string[] = []

    const text = (query.text ?? '').trim()
    const hasText = text.length > 0

    if (hasText) {
      params.push(text)
      conditions.push(`p.search_vector @@ websearch_to_tsquery('english', $${params.length})`)
    }

    const filters = query.filters ?? {}

    if (filters.category) {
      params.push(filters.category)
      conditions.push(`p.category = $${params.length}`)
    }
    if (filters.subcategory) {
      params.push(filters.subcategory)
      conditions.push(`p.subcategory = $${params.length}`)
    }
    if (filters.brands?.length) {
      params.push(filters.brands.map((b) => b.toLowerCase()))
      conditions.push(`lower(p.brand) = any($${params.length}::text[])`)
    }
    if (filters.colors?.length) {
      params.push(filters.colors.map((c) => c.toLowerCase()))
      conditions.push(`p.attributes->>'color' = any($${params.length}::text[])`)
    }
    if (filters.fits?.length) {
      params.push(filters.fits.map((f) => f.toLowerCase()))
      conditions.push(`p.attributes->>'fit' = any($${params.length}::text[])`)
    }
    if (filters.sizes?.length) {
      params.push(filters.sizes.map((s) => s.toUpperCase()))
      conditions.push(
        `exists (select 1 from product_variants pv
                  where pv.product_id = p.id and upper(pv.size) = any($${params.length}::text[]))`,
      )
    }
    if (filters.minPrice !== undefined) {
      params.push(filters.minPrice)
      conditions.push(`b.current_price >= $${params.length}`)
    }
    if (filters.maxPrice !== undefined) {
      params.push(filters.maxPrice)
      conditions.push(`b.current_price <= $${params.length}`)
    }
    if (filters.minDiscount !== undefined && filters.minDiscount > 0) {
      params.push(filters.minDiscount)
      conditions.push(
        `b.original_price is not null
           and round(((b.original_price - b.current_price) / b.original_price) * 100) >= $${params.length}`,
      )
    }
    if (filters.availability?.length) {
      params.push(filters.availability)
      conditions.push(`b.availability = any($${params.length}::text[])`)
    } else {
      // Default to things the user can actually buy.
      conditions.push(`b.availability in ('in_stock', 'low_stock')`)
    }

    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const rank = hasText
      ? `ts_rank_cd(p.search_vector, websearch_to_tsquery('english', $1))`
      : `0::real`

    const cte = `
      with best as (
        select mp.product_id, mp.current_price, mp.original_price, mp.availability, mp.id,
               row_number() over (
                 partition by mp.product_id
                 order by (mp.availability in ('in_stock','low_stock')) desc,
                          mp.current_price asc, m.name asc, mp.id asc
               ) as rn
          from merchant_products mp
          join merchants m on m.id = mp.merchant_id
         where m.status = 'active'
      ),
      matched as (
        select p.id,
               p.category,
               p.brand,
               p.attributes->>'color' as color,
               b.current_price,
               b.original_price,
               case when b.original_price is not null and b.original_price > 0
                    then round(((b.original_price - b.current_price) / b.original_price) * 100)
                    else null end as discount_pct,
               ${rank} as rank,
               p.created_at
          from products p
          join best b on b.product_id = p.id and b.rn = 1
          ${where}
      )
    `

    return { cte, params, hasText }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const page = Math.max(1, Math.floor(query.page ?? 1))
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? PAGE_SIZE.search))
    const requestedSort: SearchSort = query.sort ?? 'relevance'

    const { cte, params } = this.build(query)

    const [ids, total] =
      requestedSort === 'deal_score'
        ? await this.pageByDealScore(cte, params, page, pageSize)
        : await this.pageBySql(cte, params, requestedSort, page, pageSize)

    const items = await loadProductSummaries(this.db, ids)

    const [categories, brands, colors, bounds] = await Promise.all([
      this.facet(cte, params, 'category', 12),
      this.facet(cte, params, 'brand', 15),
      this.facet(cte, params, 'color', 15),
      this.db.query<{ lo: unknown; hi: unknown }>(
        `${cte} select min(current_price) as lo, max(current_price) as hi from matched`,
        params,
      ),
    ])

    const lo = bounds[0]?.lo

    return {
      items,
      total,
      page,
      pageSize,
      facets: {
        categories: categories.map((facet) => ({
          ...facet,
          label: CATEGORY_LABELS[facet.value as Category] ?? facet.label,
        })),
        brands,
        colors,
      },
      priceBounds:
        lo === null || lo === undefined ? null : { min: num(lo), max: num(bounds[0]?.hi) },
    }
  }

  /** Ordinary SQL-ordered pagination. */
  private async pageBySql(
    cte: string,
    baseParams: unknown[],
    sort: SearchSort,
    page: number,
    pageSize: number,
  ): Promise<[string[], number]> {
    const orderBy = SORT_SQL[(sort === 'deal_score' ? 'relevance' : sort) as keyof typeof SORT_SQL]
    const params = [...baseParams, pageSize, (page - 1) * pageSize]

    const rows = await this.db.query<{ id: string; total: number }>(
      `${cte}
       select id, count(*) over() as total
         from matched
        order by ${orderBy}
        limit $${params.length - 1} offset $${params.length}`,
      params,
    )

    return [rows.map((row) => str(row.id)), rows.length > 0 ? num(rows[0].total) : 0]
  }

  /**
   * Pagination ordered by the real deal score.
   *
   * Loads the match set (capped), computes deal assessments through the same
   * engine the rest of the app uses, then slices. Slower than an indexed sort
   * and honest about what it is ordering by.
   */
  private async pageByDealScore(
    cte: string,
    baseParams: unknown[],
    page: number,
    pageSize: number,
  ): Promise<[string[], number]> {
    const params = [...baseParams, DEAL_SORT_CANDIDATE_CAP]

    const rows = await this.db.query<{ id: string; total: number }>(
      `${cte}
       select id, count(*) over() as total
         from matched
        order by discount_pct desc nulls last, id asc
        limit $${params.length}`,
      params,
    )

    const total = rows.length > 0 ? num(rows[0].total) : 0
    const summaries = await loadProductSummaries(
      this.db,
      rows.map((row) => str(row.id)),
    )

    const ordered = summaries
      .slice()
      .sort((a, b) => {
        if (b.deal.score !== a.deal.score) return b.deal.score - a.deal.score
        // Prefer well-evidenced scores over provisional ones at equal score.
        if (a.deal.limitedEvidence !== b.deal.limitedEvidence) {
          return a.deal.limitedEvidence ? 1 : -1
        }
        return a.product.id.localeCompare(b.product.id)
      })
      .slice((page - 1) * pageSize, page * pageSize)
      .map((summary) => summary.product.id)

    return [ordered, total]
  }

  /** Facet counts over the filtered match set. */
  private async facet(
    cte: string,
    params: unknown[],
    column: 'category' | 'brand' | 'color',
    limit: number,
  ): Promise<SearchFacetValue[]> {
    // `column` is a closed union defined in this file, never request input.
    const rows = await this.db.query<{ value: string; count: number }>(
      `${cte}
       select ${column} as value, count(*)::int as count
         from matched
        where ${column} is not null
        group by ${column}
        order by count desc, value asc
        limit ${Number(limit)}`,
      params,
    )

    return rows.map((row) => ({
      value: str(row.value),
      label: str(row.value),
      count: num(row.count),
    }))
  }

  async suggest(prefix: string, limit = 8): Promise<string[]> {
    const trimmed = prefix.trim()
    if (trimmed.length < 2) return []

    const rows = await this.db.query<{ suggestion: string }>(
      `select distinct suggestion from (
         select brand as suggestion from products where brand ilike $1 || '%'
         union
         select canonical_title as suggestion from products where canonical_title ilike '%' || $1 || '%'
         union
         select subcategory as suggestion from products where subcategory ilike $1 || '%'
       ) s
       where suggestion is not null
       order by suggestion asc
       limit $2`,
      [trimmed, Math.min(20, Math.max(1, limit))],
    )

    return rows.map((row) => str(row.suggestion))
  }
}
