import 'server-only'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from './types'
import { logger } from '@/lib/logging/logger'

/**
 * Forward-only SQL migration runner.
 *
 * Migrations are plain `.sql` files applied in filename order and recorded in
 * `schema_migrations`. The checksum guards against a migration being edited
 * after it has been applied somewhere, which is the usual way schema drift
 * starts. The same files are what `supabase db push` applies in production.
 */

export const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations')

export type Migration = { name: string; sql: string; checksum: string }

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(dir)
  const files = entries.filter((f) => f.endsWith('.sql')).sort()

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8')
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) }
    }),
  )
}

async function ensureMigrationsTable(db: Db): Promise<void> {
  await db.exec(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `)
}

export type MigrateResult = { applied: string[]; skipped: string[] }

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrateResult> {
  await ensureMigrationsTable(db)

  const migrations = await loadMigrations(dir)
  const existing = await db.query<{ name: string; checksum: string }>(
    'select name, checksum from schema_migrations',
  )
  const applied = new Map(existing.map((r) => [r.name, r.checksum]))

  const result: MigrateResult = { applied: [], skipped: [] }

  for (const migration of migrations) {
    const previous = applied.get(migration.name)

    if (previous) {
      if (previous !== migration.checksum) {
        throw new Error(
          `Migration "${migration.name}" changed after it was applied ` +
            `(recorded ${previous}, found ${migration.checksum}). ` +
            'Migrations are immutable — add a new migration instead.',
        )
      }
      result.skipped.push(migration.name)
      continue
    }

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql)
      await tx.query('insert into schema_migrations (name, checksum) values ($1, $2)', [
        migration.name,
        migration.checksum,
      ])
    })

    logger.info('migration applied', { migration: migration.name })
    result.applied.push(migration.name)
  }

  return result
}

/** True when the core schema is present. */
export async function isMigrated(db: Db): Promise<boolean> {
  const rows = await db.query<{ present: boolean }>(
    `select to_regclass('public.products') is not null as present`,
  )
  return Boolean(rows[0]?.present)
}
