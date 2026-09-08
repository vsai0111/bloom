import { loadScriptEnv, describeTarget } from './_env'

loadScriptEnv()

/**
 * Apply outstanding SQL migrations.
 *
 *   npm run db:migrate
 *
 * Safe to run repeatedly: already-applied migrations are skipped, and a
 * migration whose contents changed after being applied is a hard error.
 */
async function main(): Promise<void> {
  const { createDbHandle } = await import('../lib/db/connect')
  const { migrate } = await import('../lib/db/migrate')

  console.log(`Migrating ${describeTarget()}`)

  const db = await createDbHandle()
  try {
    const { applied, skipped } = await migrate(db)

    if (applied.length === 0) {
      console.log(`Already up to date (${skipped.length} migration(s) applied previously).`)
    } else {
      console.log(`Applied ${applied.length} migration(s):`)
      for (const name of applied) console.log(`  + ${name}`)
    }
  } finally {
    await db.close()
  }
}

main().catch((error: unknown) => {
  console.error('\nMigration failed:')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
