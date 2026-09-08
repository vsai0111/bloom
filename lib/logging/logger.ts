/**
 * Structured logging.
 *
 * Emits single-line JSON in production so a log drain can parse it, and a
 * readable form in development. There is deliberately no third-party
 * dependency: `reportError` is the seam where Sentry (or any other reporter)
 * gets attached later — see docs/deployment.md.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function activeLevel(): LogLevel {
  const raw = process.env.BLOOM_LOG_LEVEL
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return 'info'
}

export type LogContext = Record<string, unknown>

/** Keys whose values are never written to logs. */
const REDACTED_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'api_key',
  'service_role_key',
  'email',
])

function redact(context: LogContext): LogContext {
  const out: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (REDACTED_KEYS.has(key)) {
      out[key] = '[redacted]'
    } else if (value instanceof Error) {
      out[key] = { name: value.name, message: value.message, stack: value.stack }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as LogContext)
    } else {
      out[key] = value
    }
  }
  return out
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel()]) return

  const payload = {
    level,
    time: new Date().toISOString(),
    message,
    ...redact(context),
  }

  const line =
    process.env.NODE_ENV === 'production'
      ? JSON.stringify(payload)
      : `[${level}] ${message}${Object.keys(context).length ? ` ${JSON.stringify(redact(context))}` : ''}`

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),

  /** Child logger that stamps every line with shared context. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    }
  },
}

/**
 * Report an unexpected error. Returns a short reference id that is safe to show
 * to a user, so a support request can be tied back to a log line without ever
 * leaking a stack trace to the browser.
 */
export function reportError(error: unknown, context: LogContext = {}): string {
  const reference = Math.random().toString(36).slice(2, 10)
  const normalized =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')

  logger.error(normalized.message, { ...context, reference, error: normalized })

  // Sentry (or another reporter) is attached here when SENTRY_DSN is configured.
  return reference
}
