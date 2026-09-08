import { createRng } from '@/lib/utils/random'
import { round2 } from '@/lib/utils/number'

/**
 * Synthetic price history for the seed catalogue.
 *
 * A deal engine cannot be evaluated — or demonstrated — without price history,
 * and no merchant feed is available to supply real history yet. This generates
 * plausible histories deterministically so the whole product works end to end.
 *
 * Two rules keep this honest:
 *   1. Every generated observation is written with `source = 'seed'`, so seeded
 *      history is distinguishable from real observations in the database
 *      forever, and can be deleted wholesale when real data arrives.
 *   2. The generator is the ONLY place synthetic prices exist. The deal engine
 *      reads price_history without knowing or caring how a row got there, so it
 *      behaves identically on real data.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface GeneratedPriceSeries {
  /** Observations, oldest first. */
  points: Array<{ price: number; recordedAt: Date }>
  /** The price the listing is at right now (the final observation). */
  currentPrice: number
  /**
   * The listing's undiscounted price, or null when it is not currently on sale.
   * Never below `currentPrice`.
   */
  originalPrice: number | null
}

export interface PriceSeriesOptions {
  /** Stable seed — same input always yields the same series. */
  seed: string
  /** The listing's normal, undiscounted price. */
  listPrice: number
  /** How many days of history to generate. */
  days?: number
  /** Days between observations. */
  intervalDays?: number
  /** Probability this listing is currently in a sale period. */
  discountRate?: number
  /** End of the series. Injectable so tests are stable. */
  now?: Date
}

/**
 * Generate a price series with realistic structure: a stable list price, one or
 * two discrete sale periods, and small drift — rather than pure noise, which
 * would make every product look equally average.
 */
export function generatePriceSeries(options: PriceSeriesOptions): GeneratedPriceSeries {
  const {
    seed,
    listPrice,
    days = 120,
    intervalDays = 4,
    discountRate = 0.4,
    now = new Date(),
  } = options

  const rng = createRng(seed)
  const observationCount = Math.max(2, Math.floor(days / intervalDays))

  // Decide the sale windows up front so they are contiguous blocks rather than
  // isolated spikes: a price that alternates every observation is not realistic
  // and would make "typical price" meaningless.
  const saleWindows: Array<{ start: number; end: number; depth: number }> = []
  const saleCount = rng.chance(0.55) ? (rng.chance(0.3) ? 2 : 1) : 0

  for (let i = 0; i < saleCount; i++) {
    const start = rng.int(1, Math.max(1, observationCount - 6))
    const length = rng.int(2, 6)
    saleWindows.push({
      start,
      end: Math.min(observationCount - 2, start + length),
      // Sale depths cluster at the usual retail marks.
      depth: rng.pick([0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]),
    })
  }

  const isOnSaleAt = (index: number): number => {
    for (const window of saleWindows) {
      if (index >= window.start && index <= window.end) return window.depth
    }
    return 0
  }

  const points: Array<{ price: number; recordedAt: Date }> = []

  for (let i = 0; i < observationCount; i++) {
    const daysAgo = (observationCount - 1 - i) * intervalDays
    // Small drift so the list price is not perfectly flat.
    const drift = 1 + rng.float(-0.02, 0.02)
    const depth = isOnSaleAt(i)
    const price = round2(listPrice * drift * (1 - depth))

    points.push({ price, recordedAt: new Date(now.getTime() - daysAgo * DAY_MS) })
  }

  // Decide the current state, then make the final observation agree with it —
  // the listing's current_price and its latest history row must never disagree.
  const currentlyDiscounted = rng.chance(discountRate)
  const currentDepth = currentlyDiscounted ? rng.pick([0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.55]) : 0
  const currentPrice = round2(listPrice * (1 - currentDepth))

  points[points.length - 1] = { price: currentPrice, recordedAt: new Date(now.getTime()) }

  return {
    points,
    currentPrice,
    originalPrice: currentDepth > 0 ? round2(listPrice) : null,
  }
}

/**
 * Round a price to a plausible retail ending (.00, .95 or .99) so seeded
 * catalogues do not look machine-generated.
 */
export function retailRound(value: number, seed: string): number {
  const rng = createRng(seed)
  const whole = Math.floor(value)
  const ending = rng.pick([0, 0.95, 0.99, 0.5])
  return round2(whole + ending)
}
