/**
 * Row coercion helpers.
 *
 * Postgres returns `numeric` as a *string* (both over the wire and from PGlite)
 * to preserve exact decimal precision. Prices must therefore be converted
 * explicitly at the repository boundary — implicit coercion is how `"19.99"`
 * ends up concatenated instead of added, and how a price silently becomes NaN.
 */

/** Coerce a numeric column to a number, falling back when null or unparseable. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/** Coerce a nullable numeric column. */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = num(value, Number.NaN)
  return Number.isFinite(parsed) ? parsed : null
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? fallback
      : String(value)
}

export function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

export function bool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1
}

/** Timestamps arrive as Date (PGlite) or string (postgres). Normalise to ISO. */
export function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  return new Date(0).toISOString()
}

/** JSONB arrives already parsed, but defend against a string just in case. */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

/** text[] arrives as a JS array from both drivers. */
export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}
