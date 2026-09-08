import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/config/auth'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Password hashing for the local auth provider.
 *
 * scrypt from Node's standard library: memory-hard, no dependency, and
 * available on every runtime Bloom targets. Parameters are stored inside the
 * hash string so they can be raised later without invalidating existing
 * passwords.
 *
 * When Supabase Auth is configured this file is unused — Supabase does its own
 * hashing and Bloom never sees a password.
 */

const PARAMS = { N: 16_384, r: 8, p: 1 }
const KEY_LENGTH = 64
const SALT_BYTES = 16
// scrypt needs roughly 128 * N * r bytes; Node's default cap is below that.
const MAXMEM = 64 * 1024 * 1024

export interface PasswordPolicyResult {
  ok: boolean
  message?: string
}

/**
 * Password policy.
 *
 * Length is the requirement that actually correlates with resistance to
 * guessing; forced character-class rules mostly produce "Password1!" and are
 * deliberately not imposed. A small deny-list catches the worst choices.
 */
const COMMON_PASSWORDS = new Set([
  'password12',
  'password123',
  'passw0rd12',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'letmein123',
  'iloveyou12',
  'welcome123',
  'admin12345',
])

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: 'That password is too long.' }
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, message: 'That password is too common. Choose something less guessable.' }
  }
  return { ok: true }
}

/** Hash a password. Output encodes the algorithm and parameters used. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAXMEM })
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/**
 * Verify a password against a stored hash.
 *
 * Uses a constant-time comparison so response timing does not leak how much of
 * the hash matched. Returns false rather than throwing on a malformed stored
 * hash, so a corrupt row cannot become an authentication bypass.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false

    const [, n, r, p, saltB64, hashB64] = parts
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')

    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    })

    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
