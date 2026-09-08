/** Small numeric helpers shared by the pricing, deal and ranking code. */

/** Round to 2 decimal places without binary-float drift on .005 cases. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Round to 4 decimal places. Used for fractions such as discount rates. */
export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

/** Constrain a value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Clamp to the unit interval, the range every scoring component works in. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/** Arithmetic mean, or null for an empty set. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
