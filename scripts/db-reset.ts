import { loadScriptEnv, describeTarget } from './_env'

loadScriptEnv()

/**
 * Drop everything Bloom owns and rebuild from migrations + seed.
 *
 *   npm run db:reset
 *
 * Destructive. Refuses to run against a remote database unless BLOOM_ALLOW_
 * REMOTE_RESET=yes is set, so a stray invocation cannot wipe a shared
 * environment.
 */
async function main(): Promise<void> {
  const driver =
    process.env.BLOOM_DB_DRIVER && process.env.BLOOM_DB_DRIVER !== 'auto'
      ? process.env.BLOOM_DB_DRIVER
      : process.env.DATABASE_URL
        ? 'postgres'
        : 'pglite'

  if (driver !== 'pglite' && process.env.BLOOM_ALLOW_REMOTE_RESET !== 'yes') {
    console.error(
      `Refusing to reset ${describeTarget()}.\n` +
        'This would drop every table. If you are certain, re-run with BLOOM_ALLOW_REMOTE_RESET=yes.',
    )
    process.exitCode = 1
    return
  }

  const { createDbHandle } = await import('../lib/db/connect')
  const { migrate } = await import('../lib/db/migrate')
  const { seedDatabase } = await import('../services/ingestion/seed-runner')

  console.log(`Resetting ${describeTarget()}`)
  const db = await createDbHandle()

  try {
    await db.exec('drop schema public cascade; create schema public;')
    await migrate(db)
    const summary = await seedDatabase(db)
    console.log('\nReset complete:')
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key.padEnd(20)} ${value}`)
    }
  } finally {
    await db.close()
  }
}

main().catch((error: unknown) => {
  console.error('\nReset failed:')
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
