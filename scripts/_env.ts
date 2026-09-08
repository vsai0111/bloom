import { config } from 'dotenv'

/**
 * Load environment for CLI scripts.
 *
 * Next.js does this automatically for the app; standalone scripts do not get it
 * for free. `.env.local` wins over `.env`, matching Next.js precedence.
 */
export function loadScriptEnv(): void {
  config({ path: '.env.local', quiet: true })
  config({ quiet: true })
}

/** Print a short summary of where this script is about to write. */
export function describeTarget(): string {
  const driver =
    process.env.BLOOM_DB_DRIVER && process.env.BLOOM_DB_DRIVER !== 'auto'
      ? process.env.BLOOM_DB_DRIVER
      : process.env.DATABASE_URL
        ? 'postgres'
        : 'pglite'

  if (driver === 'pglite') {
    return `embedded postgres (pglite) at ${process.env.PGLITE_DATA_DIR || '.bloom/pgdata'}`
  }

  // Never print the connection string: it contains the database password.
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return `postgres at ${url.host}${url.pathname}`
  } catch {
    return 'postgres (connection string not parseable)'
  }
}
