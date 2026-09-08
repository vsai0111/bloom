import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasEphemeralFilesystem, resolvePgliteDataDir, type EnvLike } from '@/lib/db/data-dir'

/**
 * Regression cover for the Vercel 500: `ENOENT: mkdir '.bloom'`.
 *
 * The embedded driver used to `mkdir` its configured `PGLITE_DATA_DIR`
 * verbatim. That value is project-relative by default, so on a serverless
 * runtime it resolved against the read-only deployment bundle and every request
 * that touched the database failed. These tests pin the rule that a relative
 * data directory is never resolved against the project on such a runtime.
 */

/** The shipped default from config/env.server.ts. */
const DEFAULT_DATA_DIR = '.bloom/pgdata'

const SERVERLESS: EnvLike = { VERCEL: '1' }
const WORKSTATION: EnvLike = {}

/**
 * Whether `child` lies beneath `parent`.
 *
 * Not `relative().startsWith('..')`: on Windows the project and the temp
 * directory can sit on different drives, and `path.relative` then returns an
 * absolute path rather than a `..` walk.
 */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

describe('ephemeral filesystem detection', () => {
  it('recognises the serverless runtimes Bloom is deployed to', () => {
    expect(hasEphemeralFilesystem({ VERCEL: '1' })).toBe(true)
    expect(hasEphemeralFilesystem({ AWS_LAMBDA_FUNCTION_NAME: 'bloom' })).toBe(true)
    expect(hasEphemeralFilesystem({ LAMBDA_TASK_ROOT: '/var/task' })).toBe(true)
    expect(hasEphemeralFilesystem({ NETLIFY: 'true' })).toBe(true)
  })

  it('treats an ordinary machine as writable', () => {
    expect(hasEphemeralFilesystem({})).toBe(false)
    expect(hasEphemeralFilesystem({ NODE_ENV: 'production' })).toBe(false)
  })

  it('lets BLOOM_EPHEMERAL_DATA_DIR override detection in both directions', () => {
    expect(hasEphemeralFilesystem({ BLOOM_EPHEMERAL_DATA_DIR: '1' })).toBe(true)
    expect(hasEphemeralFilesystem({ VERCEL: '1', BLOOM_EPHEMERAL_DATA_DIR: '0' })).toBe(false)
  })
})

describe('PGlite data directory resolution', () => {
  it('never places a project-local .bloom directory on a serverless runtime', () => {
    const { dir, ephemeral } = resolvePgliteDataDir(DEFAULT_DATA_DIR, SERVERLESS)

    expect(dir).not.toBeNull()
    expect(ephemeral).toBe(true)

    // The actual defect: `.bloom` under the deployment bundle root.
    expect(isInside(process.cwd(), dir!)).toBe(false)
    expect(dir!.split(path.sep)).not.toContain('.bloom')

    // And it must be somewhere the runtime will actually let us write.
    expect(isInside(os.tmpdir(), dir!)).toBe(true)
  })

  it('resolves relative directories inside the project on a writable filesystem', () => {
    const { dir, ephemeral } = resolvePgliteDataDir(DEFAULT_DATA_DIR, WORKSTATION)

    expect(dir).toBe(path.resolve(process.cwd(), DEFAULT_DATA_DIR))
    expect(ephemeral).toBe(false)
  })

  it('always returns an absolute path, so cwd cannot decide it later', () => {
    for (const env of [SERVERLESS, WORKSTATION]) {
      expect(path.isAbsolute(resolvePgliteDataDir(DEFAULT_DATA_DIR, env).dir!)).toBe(true)
    }
  })

  it('keeps distinct relative directories distinct when redirected to temp', () => {
    const a = resolvePgliteDataDir('.bloom/test-aaa', SERVERLESS).dir
    const b = resolvePgliteDataDir('.bloom/test-bbb', SERVERLESS).dir

    expect(a).not.toBe(b)
  })

  it('honours an absolute directory as chosen by the operator', () => {
    const chosen = path.join(os.tmpdir(), 'operator-chosen', 'pgdata')

    expect(resolvePgliteDataDir(chosen, SERVERLESS).dir).toBe(path.normalize(chosen))
    expect(resolvePgliteDataDir(chosen, WORKSTATION).dir).toBe(path.normalize(chosen))
  })

  it('keeps the in-memory database in memory', () => {
    expect(resolvePgliteDataDir('memory://', SERVERLESS)).toEqual({ dir: null, ephemeral: true })
    expect(resolvePgliteDataDir('', WORKSTATION)).toEqual({ dir: null, ephemeral: true })
  })
})
