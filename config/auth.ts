/**
 * Auth constants shared by client and server.
 *
 * Deliberately dependency-free. The password *implementation* lives in
 * lib/auth/password.ts, which imports node:crypto — importing that module from
 * a Client Component would pull Node built-ins into the browser bundle and
 * break at runtime. Anything the client needs to know about the password policy
 * belongs here instead.
 */

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200
