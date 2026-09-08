import 'server-only'
import { z } from 'zod'

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
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().or(z.literal('')),
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
  cached = parsed.data
  return cached
}

/** Reset the memoised env. Test-only. */
export function resetServerEnvCache(): void {
  cached = null
}

/** Which database driver should be used, after resolving `auto`. */
export function resolveDbDriver(): 'postgres' | 'pglite' {
  const env = serverEnv()
  if (env.BLOOM_DB_DRIVER !== 'auto') return env.BLOOM_DB_DRIVER
  return env.DATABASE_URL ? 'postgres' : 'pglite'
}

/** True when Supabase Auth should be used instead of the local auth provider. */
export function supabaseAuthConfigured(): boolean {
  const env = serverEnv()
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
