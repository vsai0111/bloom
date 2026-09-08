/**
 * Browser-safe configuration.
 *
 * Every value here is compiled into the client bundle, so it must contain
 * nothing secret. `process.env.NEXT_PUBLIC_*` is referenced literally because
 * Next.js inlines these at build time only for static member expressions.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
} as const

/** True when Supabase Auth is configured for the browser. */
export const supabaseAuthEnabled = Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey)

/** True when a third-party analytics sink is configured. */
export const posthogEnabled = Boolean(publicEnv.posthogKey)
