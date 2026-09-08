import { loadScriptEnv, describeTarget } from './_env'

loadScriptEnv()

/**
 * Populate the catalogue from the seed providers.
 *
 *   npm run db:seed
 *
 * Idempotent — safe to re-run. See services/ingestion/seed-runner.ts.
 */
async function main(): Promise<void> {
  const { createDbHandle } = await import('../lib/db/connect')
  const { migrate } = await import('../lib/db/migrate')
  const { seedDatabase } = await import('../services/ingestion/seed-runner')

  console.log(`Seeding ${describeTarget()}`)

  const db = await createDbHandle()
  try {
    await migrate(db)
    const summary = await seedDatabase(db)
    console.log('\nSeed summary:')
    for (const [key, value] of Object.entries(summary)) {
      console.log(`  ${key.padEnd(20)} ${value}`)
    }
  } finally {
    await db.close()
  }
}

main().catch((error: unknown) => {
  console.error('\nSeeding failed:')
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
