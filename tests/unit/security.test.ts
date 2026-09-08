import { describe, expect, it } from 'vitest'
import {
  hostMatches,
  isSafeHttpUrl,
  parseUrl,
  safeInternalPath,
  validateRedirectTarget,
} from '@/lib/utils/url'
import { normalizeProduct } from '@/services/normalization/normalize'
import { createSessionToken, readSessionToken } from '@/lib/auth/session'
import { checkPasswordPolicy, hashPassword, verifyPassword } from '@/lib/auth/password'

/**
 * Security-focused tests.
 *
 * These cover the places where untrusted input reaches something dangerous:
 * outbound redirects, stored URLs that end up in href attributes, session
 * tokens, and password verification.
 */

describe('URL safety', () => {
  it('accepts only absolute http(s) URLs', () => {
    expect(isSafeHttpUrl('https://example.com/p/1')).toBe(true)
    expect(isSafeHttpUrl('http://example.com')).toBe(true)

    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeHttpUrl('/relative/path')).toBe(false)
    expect(isSafeHttpUrl('')).toBe(false)
    expect(isSafeHttpUrl(null)).toBe(false)
    expect(isSafeHttpUrl(undefined)).toBe(false)
  })

  it('rejects protocol tricks that look like http', () => {
    expect(isSafeHttpUrl('javascript:https://example.com')).toBe(false)
    // A newline inside the scheme is a classic filter bypass.
    expect(isSafeHttpUrl('java\nscript:alert(1)')).toBe(false)
  })

  it('anchors host matching on a dot boundary', () => {
    expect(hostMatches('example.com', 'example.com')).toBe(true)
    expect(hostMatches('shop.example.com', 'example.com')).toBe(true)

    // The attack this prevents: registering evil-example.com to satisfy an
    // allowlist entry of example.com.
    expect(hostMatches('evil-example.com', 'example.com')).toBe(false)
    expect(hostMatches('example.com.evil.net', 'example.com')).toBe(false)
    expect(hostMatches('notexample.com', 'example.com')).toBe(false)
  })

  it('validates redirect targets against the merchant allowlist', () => {
    const allowed = ['shop.example.com']

    expect(validateRedirectTarget('https://shop.example.com/p/1', allowed)).not.toBeNull()
    expect(validateRedirectTarget('https://cdn.shop.example.com/p/1', allowed)).not.toBeNull()

    expect(validateRedirectTarget('https://evil.test/p/1', allowed)).toBeNull()
    expect(validateRedirectTarget('https://shop.example.com.evil.test', allowed)).toBeNull()
    expect(validateRedirectTarget('javascript:alert(1)', allowed)).toBeNull()

    // An empty allowlist must deny everything, not allow everything.
    expect(validateRedirectTarget('https://shop.example.com', [])).toBeNull()
  })

  it('keeps internal redirect paths on-origin', () => {
    expect(safeInternalPath('/home')).toBe('/home')
    expect(safeInternalPath('/search?q=linen')).toBe('/search?q=linen')

    expect(safeInternalPath('//evil.com')).toBe('/')
    expect(safeInternalPath('/\\evil.com')).toBe('/')
    expect(safeInternalPath('https://evil.com')).toBe('/')
    expect(safeInternalPath('javascript:alert(1)')).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath(123)).toBe('/')
  })

  it('parses without throwing on rubbish', () => {
    expect(parseUrl('not a url')).toBeNull()
    expect(parseUrl({})).toBeNull()
  })
})

describe('normalization rejects hostile merchant data', () => {
  const base = {
    externalId: 'X1',
    title: 'Aera Linen Shirt',
    brand: 'Aera',
    category: 'clothing',
    price: 50,
  }

  it('refuses a product whose URL is a script scheme', () => {
    const result = normalizeProduct({ ...base, productUrl: 'javascript:alert(1)' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/productUrl/)
  })

  it('drops unsafe image URLs but keeps the product', () => {
    const result = normalizeProduct({
      ...base,
      productUrl: 'https://example.test/p/1',
      images: ['javascript:alert(1)', 'https://cdn.example.test/a.jpg'],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.images).toEqual(['https://cdn.example.test/a.jpg'])
      expect(result.warnings.join(' ')).toMatch(/unsafe image/)
    }
  })

  it('refuses a product with no brand rather than guessing one', () => {
    const result = normalizeProduct({
      externalId: 'X1',
      title: 'Some Shirt',
      category: 'clothing',
      price: 50,
      productUrl: 'https://example.test/p/1',
    })
    expect(result.ok).toBe(false)
  })

  it('refuses an unusable price rather than defaulting it to zero', () => {
    const result = normalizeProduct({
      ...base,
      price: 'call for price',
      productUrl: 'https://example.test/p/1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/price/)
  })

  it('discards a fake original price that would imply a discount', () => {
    const result = normalizeProduct({
      ...base,
      price: 50,
      originalPrice: 40, // lower than current: not a discount, bad data
      productUrl: 'https://example.test/p/1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.listing.originalPrice).toBeNull()
      expect(result.value.listing.discountFraction).toBeNull()
    }
  })

  it('normalises a messy but legitimate listing', () => {
    const result = normalizeProduct({
      externalId: 'MG-1',
      title: 'NEW! Aera Boxy Cotton Tee - Olive - M',
      brand: 'Aera',
      category: 'Women > Clothing',
      subcategory: 't-shirts',
      price: '$42.00',
      originalPrice: '60.00',
      availability: 'In Stock',
      productUrl: 'https://example.test/p/1',
      attributes: { Colour: 'Olive', Fabric: 'organic cotton', fit: 'boxy' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.category).toBe('clothing')
      expect(result.value.attributes.color).toBe('olive')
      expect(result.value.attributes.material).toBe('cotton')
      expect(result.value.attributes.fit).toBe('boxy')
      expect(result.value.listing.currentPrice).toBe(42)
      expect(result.value.listing.originalPrice).toBe(60)
      expect(result.value.listing.availability).toBe('in_stock')
    }
  })

  it('treats unrecognised availability as out of stock, not in stock', () => {
    const result = normalizeProduct({
      ...base,
      availability: 'who knows',
      productUrl: 'https://example.test/p/1',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.listing.availability).toBe('out_of_stock')
  })
})

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken('11111111-1111-1111-1111-111111111111')
    expect(readSessionToken(token)).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('rejects a tampered payload', () => {
    const token = createSessionToken('11111111-1111-1111-1111-111111111111')
    const [body, signature] = token.split('.')

    const forgedBody = Buffer.from(
      JSON.stringify({ sub: '22222222-2222-2222-2222-222222222222', exp: 9_999_999_999 }),
    ).toString('base64url')

    expect(readSessionToken(`${forgedBody}.${signature}`)).toBeNull()
    expect(readSessionToken(`${body}.deadbeef`)).toBeNull()
  })

  it('rejects an expired token', () => {
    const expired = createSessionToken('11111111-1111-1111-1111-111111111111', -10)
    expect(readSessionToken(expired)).toBeNull()
  })

  it('rejects malformed input without throwing', () => {
    expect(readSessionToken(undefined)).toBeNull()
    expect(readSessionToken('')).toBeNull()
    expect(readSessionToken('nodot')).toBeNull()
    expect(readSessionToken('...')).toBeNull()
    expect(readSessionToken('a.b.c')).toBeNull()
  })
})

describe('passwords', () => {
  it('enforces a length floor', () => {
    expect(checkPasswordPolicy('short').ok).toBe(false)
    expect(checkPasswordPolicy('a-long-enough-password').ok).toBe(true)
  })

  it('rejects well-known passwords', () => {
    expect(checkPasswordPolicy('password123').ok).toBe(false)
    expect(checkPasswordPolicy('PASSWORD123').ok).toBe(false)
  })

  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(hash).toMatch(/^scrypt\$/)
    // The password must not be recoverable from the stored value.
    expect(hash).not.toContain('correct-horse')

    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true)
    expect(await verifyPassword('wrong-password-entirely', hash)).toBe(false)
  })

  it('produces a different hash each time for the same password', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password-here'),
      hashPassword('same-password-here'),
    ])
    expect(a).not.toBe(b)
  })

  it('returns false for a corrupt stored hash instead of throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'scrypt$1$2$3')).toBe(false)
  })
})
