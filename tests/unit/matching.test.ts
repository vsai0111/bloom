import { describe, expect, it } from 'vitest'
import {
  buildMatchKey,
  findGtin,
  findMpn,
  isValidGtin,
  normalizeMpn,
} from '@/services/normalization/matching'
import { canonicalizeTitle, displayTitle } from '@/services/normalization/vocabulary'

describe('isValidGtin', () => {
  it('accepts real check digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true) // EAN-13
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
  })

  it('rejects a bad check digit', () => {
    expect(isValidGtin('4006381333932')).toBe(false)
  })

  it('rejects wrong lengths and placeholder values', () => {
    expect(isValidGtin('123')).toBe(false)
    expect(isValidGtin('00000000000000')).toBe(false)
    expect(isValidGtin('')).toBe(false)
  })
})

describe('canonicalizeTitle', () => {
  it('collapses the same product described differently', () => {
    const a = canonicalizeTitle('NEW! Aera Boxy Cotton Tee - Olive - M', 'Aera')
    const b = canonicalizeTitle('Aera Boxy Cotton T-Shirt (Olive)', 'Aera')
    expect(a).toBe(b)
  })

  it('strips marketing noise and the brand name', () => {
    expect(canonicalizeTitle('SALE Aera Linen Shirt', 'Aera')).toBe('linen shirt')
  })

  it('keeps genuinely different products distinct', () => {
    const shirt = canonicalizeTitle('Aera Linen Shirt', 'Aera')
    const trousers = canonicalizeTitle('Aera Linen Trousers', 'Aera')
    expect(shirt).not.toBe(trousers)
  })
})

describe('displayTitle', () => {
  it('keeps the merchant wording, casing and punctuation', () => {
    expect(displayTitle('Aera Boxy Cotton T-Shirt', 'Aera')).toBe('Boxy Cotton T-Shirt')
  })

  it('strips the brand and marketing noise, not product words', () => {
    expect(displayTitle('NEW! Aera Relaxed Linen Shirt', 'Aera')).toBe('Relaxed Linen Shirt')
    expect(displayTitle('Aera Wide Leg Cotton Trousers - NEW', 'Aera')).toBe(
      'Wide Leg Cotton Trousers',
    )
  })

  it('preserves colour words, unlike the identity form', () => {
    // canonicalizeTitle deliberately drops colours; a product page must not.
    expect(displayTitle('Aera Olive Linen Shirt', 'Aera')).toBe('Olive Linen Shirt')
    expect(canonicalizeTitle('Aera Olive Linen Shirt', 'Aera')).not.toContain('olive')
  })

  it('never returns an empty title', () => {
    expect(displayTitle('Aera', 'Aera')).toBe('Aera')
  })
})

describe('buildMatchKey', () => {
  it('prefers a valid GTIN', () => {
    const result = buildMatchKey({ brand: 'Aera', title: 'Boxy Tee', gtin: '4006381333931' })
    expect(result).toMatchObject({ ok: true, strategy: 'gtin', confidence: 'high' })
  })

  it('merges two merchants selling the same GTIN', () => {
    const a = buildMatchKey({ brand: 'Aera', title: 'Boxy Cotton Tee', gtin: '4006381333931' })
    const b = buildMatchKey({ brand: 'AERA', title: 'Boxy Cotton T-Shirt', gtin: '4006381333931' })
    expect(a.ok && b.ok && a.key === b.key).toBe(true)
  })

  it('falls back past an invalid GTIN instead of trusting it', () => {
    const result = buildMatchKey({ brand: 'Aera', title: 'Boxy Tee', gtin: '1234567890123' })
    expect(result).toMatchObject({ ok: true, strategy: 'title' })
  })

  it('uses brand + MPN when there is no GTIN', () => {
    const result = buildMatchKey({ brand: 'Nordfelt', title: 'Wool Coat', mpn: 'NF-COAT-2201' })
    expect(result).toMatchObject({ ok: true, strategy: 'mpn', confidence: 'high' })
  })

  it('ignores an MPN too short to be distinctive', () => {
    const result = buildMatchKey({ brand: 'Nordfelt', title: 'Wool Coat', mpn: '01' })
    expect(result).toMatchObject({ ok: true, strategy: 'title' })
  })

  it('never merges the same title across different brands', () => {
    const a = buildMatchKey({ brand: 'Aera', title: 'Linen Shirt' })
    const b = buildMatchKey({ brand: 'Nordfelt', title: 'Linen Shirt' })
    expect(a.ok && b.ok && a.key === b.key).toBe(false)
  })

  it('merges the same product listed with different noise words', () => {
    const a = buildMatchKey({ brand: 'Aera', title: 'NEW! Aera Boxy Cotton Tee - Olive - M' })
    const b = buildMatchKey({ brand: 'Aera', title: 'Aera Boxy Cotton T-Shirt (Olive)' })
    expect(a.ok && b.ok && a.key === b.key).toBe(true)
  })

  it('refuses identity without a brand', () => {
    expect(buildMatchKey({ brand: '', title: 'Linen Shirt' }).ok).toBe(false)
  })

  it('refuses identity when the title carries no information', () => {
    expect(buildMatchKey({ brand: 'Aera', title: '' }).ok).toBe(false)
    // A title that is nothing but the brand and a colour has nothing left.
    expect(buildMatchKey({ brand: 'Aera', title: 'Aera Olive' }).ok).toBe(false)
  })

  it('keeps strategies in separate key namespaces', () => {
    const byMpn = buildMatchKey({ brand: 'Aera', title: 'Tee', mpn: 'ABCD1234' })
    const byTitle = buildMatchKey({ brand: 'Aera', title: 'ABCD1234' })
    expect(byMpn.ok && byTitle.ok && byMpn.key === byTitle.key).toBe(false)
  })
})

describe('attribute extraction', () => {
  it('finds a GTIN under any of the usual key names', () => {
    expect(findGtin({ ean13: '4006381333931' })).toBe('4006381333931')
    expect(findGtin({ 'gtin-13': '4006381333931' })).toBe('4006381333931')
    expect(findGtin({ barcode: 4006381333931 })).toBe('4006381333931')
    expect(findGtin({ colour: 'olive' })).toBeNull()
    expect(findGtin(undefined)).toBeNull()
  })

  it('finds a model number under any of the usual key names', () => {
    expect(findMpn({ model: 'NF-2201' })).toBe('NF-2201')
    expect(findMpn({ 'part number': 'X99' })).toBe('X99')
    expect(findMpn({ styleCode: 'SC-1' })).toBe('SC-1')
    expect(findMpn({ colour: 'olive' })).toBeNull()
  })

  it('never treats an aesthetic "style" attribute as a part number', () => {
    // Regression: feeds commonly send style: 'minimal'. Accepting that as an MPN
    // merged every same-style product from a brand into one canonical product.
    expect(findMpn({ style: 'minimal' })).toBeNull()
    expect(findMpn({ Style: 'sporty' })).toBeNull()

    const a = buildMatchKey({
      brand: 'Quill Devices',
      title: 'Mechanical Keyboard 75%',
      mpn: findMpn({ style: 'minimal' }),
    })
    const b = buildMatchKey({
      brand: 'Quill Devices',
      title: 'USB-C GaN Charger 65W',
      mpn: findMpn({ style: 'minimal' }),
    })
    expect(a.ok && b.ok && a.key === b.key).toBe(false)
  })

  it('normalises model numbers for comparison', () => {
    expect(normalizeMpn('nf-coat_2201')).toBe('NFCOAT2201')
  })
})
