import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetServerEnvCache, resolveDbDriver, supabaseAuthConfigured } from '@/config/env.server'

/**
 * Configuration guards that only bite in production.
 *
 * Both rules here exist to convert a silent downgrade into a loud failure:
 * `auto` quietly selecting a throwaway database, and a renamed Supabase key
 * quietly reverting the app to the local auth provider. Neither is visible from
 * a passing health check, which is exactly why they are pinned by tests.
 */

const SAVED = { ...process.env }

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetServerEnvCache()
}

beforeEach(() => {
  setEnv({
    NODE_ENV: 'production',
    BLOOM_DB_DRIVER: undefined,
    DATABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  })
})

afterEach(() => {
  process.env = { ...SAVED }
  resetServerEnvCache()
})

describe('database driver selection in production', () => {
  it('refuses to guess when the driver is left at its default', () => {
    expect(() => resolveDbDriver()).toThrow(/BLOOM_DB_DRIVER must be set explicitly/)
  })

  it('refuses `auto` even when DATABASE_URL happens to be present', () => {
    // The dangerous case is the inverse — a typo'd URL silently selecting
    // PGlite — so `auto` is rejected on its own terms, not on the URL's.
    setEnv({
      BLOOM_DB_DRIVER: 'auto',
      DATABASE_URL: 'postgresql://user:pw@db.example.com:5432/postgres',
    })
    expect(() => resolveDbDriver()).toThrow(/BLOOM_DB_DRIVER must be set explicitly/)
  })

  it('accepts an explicit postgres driver', () => {
    setEnv({
      BLOOM_DB_DRIVER: 'postgres',
      DATABASE_URL: 'postgresql://user:pw@db.example.com:5432/postgres',
    })
    expect(resolveDbDriver()).toBe('postgres')
  })

  it('still allows a deliberately chosen embedded database', () => {
    // The E2E suite runs a production build this way.
    setEnv({ BLOOM_DB_DRIVER: 'pglite' })
    expect(resolveDbDriver()).toBe('pglite')
  })

  it('leaves development free to infer the driver', () => {
    setEnv({ NODE_ENV: 'development', BLOOM_DB_DRIVER: 'auto' })
    expect(resolveDbDriver()).toBe('pglite')

    setEnv({ DATABASE_URL: 'postgresql://user:pw@db.example.com:5432/postgres' })
    expect(resolveDbDriver()).toBe('postgres')
  })
})

describe('Supabase publishable key', () => {
  const URL = 'https://project.supabase.co'
  const KEY = 'sb_publishable_example_value'

  it('enables Supabase Auth from the current variable name', () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY })
    expect(supabaseAuthConfigured()).toBe(true)
  })

  it('is not satisfied by the URL alone', () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL })
    expect(supabaseAuthConfigured()).toBe(false)
  })

  it('rejects a production environment still carrying only the pre-rename key', () => {
    // Without this guard the app would boot happily and quietly serve the local
    // auth provider, which in production is an outage that looks like a feature.
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY })
    expect(() => supabaseAuthConfigured()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('ignores the old name once the new one is set', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stale-value',
    })
    expect(supabaseAuthConfigured()).toBe(true)
  })
})
