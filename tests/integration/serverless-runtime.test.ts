import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetServerEnvCache } from '@/config/env.server'
import { createDbHandle } from '@/lib/db/connect'

/**
 * The production request path, run as it runs on Vercel.
 *
 * `GET /` reaches `getDb()`, which on a deployment with no `DATABASE_URL`
 * resolves to the embedded driver. Previously that driver called
 * `mkdir('.bloom/pgdata')`, which resolves against `process.cwd()` — the
 * read-only deployment bundle — and produced `ENOENT: mkdir '.bloom'` on every
 * request.
 *
 * This test stands in a fake, empty project root and asserts that connecting
 * under a serverless runtime both works and leaves that root untouched.
 */

const SAVED = { ...process.env }
const SAVED_CWD = process.cwd()

let projectRoot: string

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'bloom-project-'))
  // A real `chdir`, not a mocked `process.cwd()`: the bug was an OS-level
  // relative `mkdir`, which a spy on `process.cwd()` would not have affected.
  // Standing in an empty directory is what makes the assertions below real.
  process.chdir(projectRoot)

  // The Vercel environment as it actually arrives: serverless, embedded driver
  // by default, and no data directory configured.
  process.env.VERCEL = '1'
  process.env.BLOOM_DB_DRIVER = 'auto'
  delete process.env.DATABASE_URL
  delete process.env.PGLITE_DATA_DIR
  resetServerEnvCache()
})

afterEach(async () => {
  process.chdir(SAVED_CWD)
  process.env = { ...SAVED }
  resetServerEnvCache()
  await rm(projectRoot, { recursive: true, force: true })
  await rm(path.join(os.tmpdir(), 'bloom'), { recursive: true, force: true }).catch(() => {})
})

describe('connecting from a serverless runtime', () => {
  it('opens a usable database without writing into the project directory', async () => {
    const db = await createDbHandle()

    try {
      expect(db.driver).toBe('pglite')
      // A real query, so this cannot pass on a handle that never opened.
      const rows = await db.query<{ ok: number }>('select 1 as ok')
      expect(rows[0].ok).toBe(1)
    } finally {
      await db.close()
    }

    // The regression itself: nothing — least of all `.bloom` — is created
    // beneath the (read-only, in production) project root.
    expect(await readdir(projectRoot)).toEqual([])
  })

  it('still fails loudly when Postgres is demanded without a connection string', async () => {
    process.env.BLOOM_DB_DRIVER = 'postgres'
    resetServerEnvCache()

    await expect(createDbHandle()).rejects.toThrow(/DATABASE_URL/)
    expect(await readdir(projectRoot)).toEqual([])
  })
})
