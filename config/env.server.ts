import 'server-only'
import { z } from 'zod'
import { logger } from '@/lib/logging/logger'

/**
 * Server-side environment. Parsed once, lazily, so that importing this module
 * never crashes a build that does not actually touch the database.
 *
 * `server-only` makes it a build error to import this from a Client Component,
 * which is the guardrail that keeps the service-role key out of the browser.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  BLOOM_DB_DRIVER: z.enum(['auto', 'postgres', 'pglite']).default('auto'),
  DATABASE_URL: z.string().url().optional().or(z.literal('')),
  PGLITE_DATA_DIR: z.string().default('.bloom/pgdata'),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal('')),

  BLOOM_AUTH_SECRET: z.string().optional().or(z.literal('')),

  SENTRY_DSN: z.string().optional().or(z.literal('')),
  BLOOM_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type ServerEnv = z.infer<typeof schema>

let cached: ServerEnv | null = null

export function serverEnv(): ServerEnv {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid server environment configuration:\n${detail}`)
  }
  checkLegacySupabaseKey(parsed.data)

  cached = parsed.data
  return cached
}

/**
 * Supabase renamed the browser-safe API key from "anon key" to "publishable
 * key". Bloom reads only the current name.
 *
 * A deployment still carrying the old variable would therefore look
 * unconfigured, and `supabaseAuthConfigured()` would quietly hand back the
 * local auth provider — which in production is an outage wearing the costume of
 * a working app. Fail loudly there, and merely say so in development.
 */
const LEGACY_ANON_KEY = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

function checkLegacySupabaseKey(env: ServerEnv): void {
  if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return
  if (!process.env[LEGACY_ANON_KEY]) return

  const message =
    `${LEGACY_ANON_KEY} is set but NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not. ` +
    'Supabase renamed this key: rename the variable to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'

  if (env.NODE_ENV === 'production') throw new Error(message)
  logger.warn(message)
}

/** Reset the memoised env. Test-only. */
export function resetServerEnvCache(): void {
  cached = null
}

/**
 * Which database driver should be used, after resolving `auto`.
 *
 * `auto` is a development convenience and is refused in production. Letting it
 * stand there means a missing or malformed `DATABASE_URL` silently selects the
 * embedded database: the deployment serves, looks healthy, and is backed by a
 * per-instance store that empties on every cold start. An explicit driver makes
 * that choice impossible to make by accident.
 */
export function resolveDbDriver(): 'postgres' | 'pglite' {
  const env = serverEnv()
  if (env.BLOOM_DB_DRIVER !== 'auto') return env.BLOOM_DB_DRIVER

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'BLOOM_DB_DRIVER must be set explicitly in production. Set BLOOM_DB_DRIVER=postgres ' +
        'together with DATABASE_URL (the Supabase pooler connection string). ' +
        '"auto" is not accepted in production because it falls back to the embedded PGlite ' +
        'database, which is per-instance and does not survive a cold start.',
    )
  }

  return env.DATABASE_URL ? 'postgres' : 'pglite'
}

/** True when Supabase Auth should be used instead of the local auth provider. */
export function supabaseAuthConfigured(): boolean {
  const env = serverEnv()
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
}
