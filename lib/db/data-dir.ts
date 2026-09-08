import 'server-only'
import os from 'node:os'
import path from 'node:path'

/**
 * Where the embedded database is allowed to put its files.
 *
 * PGlite needs a writable directory. The configured value (`PGLITE_DATA_DIR`)
 * is project-relative by default — `.bloom/pgdata` — which is correct on a
 * developer machine and impossible in a serverless runtime, where the
 * deployment bundle is mounted read-only and `process.cwd()` is not writable.
 * Resolving a relative path against the bundle root there is what produced
 * `ENOENT: mkdir '.bloom'` on Vercel.
 *
 * So the base a relative path resolves against is chosen from the runtime
 * rather than assumed: the project directory when there is a writable project
 * directory, the OS temp directory when there is not.
 */

/** Configured values that mean "keep the database entirely in memory". */
const IN_MEMORY = new Set(['memory://', ''])

/**
 * Just enough of the environment to make this decision. Deliberately not
 * Node's own `ProcessEnv`, which Next.js augments with required keys that have
 * nothing to do with where a database file lives.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>

/**
 * True when the process filesystem is a read-only deployment bundle and only
 * the OS temp directory can be written.
 *
 * `BLOOM_EPHEMERAL_DATA_DIR` overrides the detection in both directions, so a
 * platform we have not enumerated can be told the truth without a code change.
 */
export function hasEphemeralFilesystem(env: EnvLike = process.env): boolean {
  if (env.BLOOM_EPHEMERAL_DATA_DIR === '1') return true
  if (env.BLOOM_EPHEMERAL_DATA_DIR === '0') return false

  return Boolean(
    env.VERCEL ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.LAMBDA_TASK_ROOT ||
    env.NETLIFY ||
    env.FUNCTIONS_WORKER_RUNTIME,
  )
}

export interface ResolvedDataDir {
  /** Absolute path to use, or `null` to run the database in memory. */
  dir: string | null
  /** True when the location does not survive the process that created it. */
  ephemeral: boolean
}

/**
 * Turn a configured `PGLITE_DATA_DIR` into an absolute, writable location.
 *
 * - `memory://` (or empty) stays in memory.
 * - An absolute path is taken at face value; the operator has chosen it.
 * - A relative path resolves against the project directory normally, and
 *   against the OS temp directory on a read-only runtime — under its basename,
 *   so distinct configured directories stay distinct.
 */
export function resolvePgliteDataDir(
  configured: string,
  env: EnvLike = process.env,
): ResolvedDataDir {
  const value = configured.trim()
  if (IN_MEMORY.has(value)) return { dir: null, ephemeral: true }

  if (path.isAbsolute(value)) {
    return { dir: path.normalize(value), ephemeral: hasEphemeralFilesystem(env) }
  }

  if (hasEphemeralFilesystem(env)) {
    // Deliberately not `path.resolve(cwd, value)`: cwd is the read-only bundle.
    // The basename keeps `.bloom/test-a` and `.bloom/test-b` from colliding
    // without dragging the project-local `.bloom` prefix into the temp dir.
    const name = path.basename(path.normalize(value)) || 'pgdata'
    return { dir: path.join(os.tmpdir(), 'bloom', name), ephemeral: true }
  }

  // `turbopackIgnore`: this is a directory to create at runtime, not a module
  // to load. Without the hint the build treats it as dynamic filesystem access
  // and traces the entire project — including `public/` — into the serverless
  // bundle.
  return { dir: path.resolve(/* turbopackIgnore: true */ process.cwd(), value), ephemeral: false }
}
