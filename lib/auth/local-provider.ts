import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logging/logger'
import type { AuthProvider, AuthResult } from './types'
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password'
import { clearSessionCookie, readSessionUserId, setSessionCookie } from './session'

/**
 * Local email/password authentication.
 *
 * Used when Supabase Auth is not configured, so Bloom is fully usable in
 * development and CI without external credentials. Credentials live in
 * `local_auth_users`, which has RLS enabled and no policies — meaning no
 * client-facing role can read it at all.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export class LocalAuthProvider implements AuthProvider {
  readonly id = 'local' as const

  async signUp({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    const normalized = normalizeEmail(email)

    if (!EMAIL_PATTERN.test(normalized)) {
      return { ok: false, code: 'invalid_email', message: 'Enter a valid email address.' }
    }

    const policy = checkPasswordPolicy(password)
    if (!policy.ok) {
      return {
        ok: false,
        code: 'weak_password',
        message: policy.message ?? 'Choose a stronger password.',
      }
    }

    const db = await getDb()
    const existing = await db.query<{ id: string }>(
      'select id from local_auth_users where lower(email) = $1',
      [normalized],
    )
    if (existing.length > 0) {
      return {
        ok: false,
        code: 'email_taken',
        message: 'An account already exists for that email address.',
      }
    }

    const passwordHash = await hashPassword(password)

    const rows = await db.query<{ id: string }>(
      'insert into local_auth_users (email, password_hash) values ($1, $2) returning id',
      [normalized, passwordHash],
    )
    const user = { id: rows[0].id, email: normalized }

    await setSessionCookie(user.id)
    logger.info('local signup', { userId: user.id })
    return { ok: true, user }
  }

  async signIn({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    const normalized = normalizeEmail(email)
    const db = await getDb()

    const rows = await db.query<{ id: string; email: string; password_hash: string }>(
      'select id, email, password_hash from local_auth_users where lower(email) = $1',
      [normalized],
    )

    const record = rows[0]

    // Always run a verification, even with no matching user, so that response
    // timing does not reveal whether an email address is registered.
    const valid = await verifyPassword(
      password,
      record?.password_hash ??
        'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    )

    if (!record || !valid) {
      return {
        ok: false,
        code: 'invalid_credentials',
        message: 'That email and password combination is not correct.',
      }
    }

    await setSessionCookie(record.id)
    logger.info('local signin', { userId: record.id })
    return { ok: true, user: { id: record.id, email: record.email } }
  }

  async signOut(): Promise<void> {
    await clearSessionCookie()
  }

  async getUser() {
    const userId = await readSessionUserId()
    if (!userId) return null

    const db = await getDb()
    const rows = await db.query<{ id: string; email: string }>(
      'select id, email from local_auth_users where id = $1',
      [userId],
    )

    // A valid signature for a user that no longer exists is not a session.
    return rows[0] ? { id: rows[0].id, email: rows[0].email } : null
  }
}
