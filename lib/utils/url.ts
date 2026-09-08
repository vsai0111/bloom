/**
 * URL handling and redirect safety.
 *
 * Merchant feeds are untrusted input. A product URL that is actually
 * `javascript:` or `data:` becomes stored XSS the moment it is rendered into an
 * href, and an unvalidated outbound redirect turns Bloom into an open redirect
 * that phishing campaigns can borrow our domain for. Both are closed here.
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

export function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

/** True only for absolute http(s) URLs. Everything else is rejected. */
export function isSafeHttpUrl(value: unknown): boolean {
  const url = parseUrl(value)
  return url !== null && SAFE_PROTOCOLS.has(url.protocol)
}

/** Lowercased hostname, or null when the value is not a usable URL. */
export function hostOf(value: unknown): string | null {
  return parseUrl(value)?.hostname.toLowerCase() ?? null
}

/**
 * Does `host` fall under `allowed`?
 *
 * Matches the host itself and its subdomains, anchored on a dot so that
 * `evil-example.com` does not satisfy an allowlist entry of `example.com`.
 */
export function hostMatches(host: string, allowed: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  const a = allowed.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
  if (!a) return false
  return h === a || h.endsWith(`.${a}`)
}

/**
 * Validate an outbound merchant URL against that merchant's allowlist.
 *
 * Returns the URL only when it is http(s) AND its host is one the merchant is
 * registered for. Anything else returns null and the caller must refuse to
 * redirect.
 */
export function validateRedirectTarget(
  value: unknown,
  allowedHosts: readonly string[],
): URL | null {
  const url = parseUrl(value)
  if (!url || !SAFE_PROTOCOLS.has(url.protocol)) return null
  if (allowedHosts.length === 0) return null

  const host = url.hostname.toLowerCase()
  return allowedHosts.some((allowed) => hostMatches(host, allowed)) ? url : null
}

/** Build an app-relative path, refusing anything that would leave the origin. */
export function safeInternalPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback
  // "//evil.com" is protocol-relative and leaves the origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
