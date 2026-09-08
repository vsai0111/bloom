/**
 * Deterministic pseudo-randomness.
 *
 * The seed catalogue must produce byte-identical data on every machine and every
 * run: tests assert against specific prices and deal scores, and a catalogue
 * that shifted between runs would make failures impossible to reproduce.
 * `Math.random` is therefore never used in seeding.
 */

/** FNV-1a. Turns a seed string into a 32-bit integer. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max]. */
  int(min: number, max: number): number
  /** Float in [min, max). */
  float(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** Uniformly pick one element. */
  pick<T>(items: readonly T[]): T
}

/** mulberry32 — small, fast, and good enough for generating plausible data. */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}
