// Vitest global setup. Keeps tests hermetic: they never touch a remote database
// and never emit analytics to a third party.
process.env.BLOOM_DB_DRIVER = 'pglite'
// File-backed, not memory://: a full seeded catalogue does not fit in PGlite's
// in-memory WASM heap. See tests/helpers/db.ts.
process.env.PGLITE_DATA_DIR = '.bloom/test-default'
process.env.BLOOM_AUTH_SECRET ||= 'test-secret-not-used-in-production-0000000000'
process.env.BLOOM_LOG_LEVEL ||= 'error'
delete process.env.DATABASE_URL
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
delete process.env.NEXT_PUBLIC_POSTHOG_KEY
