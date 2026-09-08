import {
  AVAILABILITY,
  CATEGORIES,
  COLORS,
  FITS,
  GENDERS,
  MATERIALS,
  STYLES,
  SUBCATEGORIES,
  type Availability,
  type Category,
  type Gender,
} from '@/config/taxonomy'

/**
 * Mapping merchant vocabulary onto Bloom's taxonomy.
 *
 * Entirely deterministic: a lookup table plus whole-word matching. Nothing here
 * guesses, and nothing calls a model. A term that is not recognised returns
 * null and the caller records a warning — a product with an unknown colour is
 * far better than a product confidently tagged the wrong colour.
 */

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function slugify(input: string): string {
  return normalizeText(input).replace(/\s+/g, '-')
}

/** Whole-word membership test, so "tan" does not match "tank top". */
function containsTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeText(term)
  if (!normalizedTerm) return false
  return new RegExp(`(^| )${escapeRegExp(normalizedTerm)}( |$)`).test(haystack)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

const CATEGORY_SYNONYMS: Record<string, Category> = {
  clothing: 'clothing',
  clothes: 'clothing',
  apparel: 'clothing',
  fashion: 'clothing',
  womenswear: 'clothing',
  menswear: 'clothing',
  garments: 'clothing',
  'ready to wear': 'clothing',

  shoes: 'shoes',
  footwear: 'shoes',
  sneakers: 'shoes',
  trainers: 'shoes',
  boots: 'shoes',

  accessories: 'accessories',
  accessory: 'accessories',
  bags: 'accessories',
  jewellery: 'accessories',
  jewelry: 'accessories',
  watches: 'accessories',
  eyewear: 'accessories',

  home: 'home',
  homeware: 'home',
  'home decor': 'home',
  furniture: 'home',
  kitchen: 'home',
  bedding: 'home',

  electronics: 'electronics',
  electronic: 'electronics',
  tech: 'electronics',
  audio: 'electronics',
  gadgets: 'electronics',
  computing: 'electronics',
}

export function mapCategory(raw: string | undefined | null): Category | null {
  if (!raw) return null
  const text = normalizeText(raw)
  if (!text) return null

  // Exact taxonomy term first.
  const direct = CATEGORIES.find((c) => c === text)
  if (direct) return direct

  const synonym = CATEGORY_SYNONYMS[text]
  if (synonym) return synonym

  // Feeds often send breadcrumb paths: "Women > Clothing > Dresses".
  for (const [term, category] of Object.entries(CATEGORY_SYNONYMS)) {
    if (containsTerm(text, term)) return category
  }
  return null
}

/**
 * Resolve a subcategory within a category, from the merchant's own value or —
 * failing that — from words in the title.
 */
export function mapSubcategory(
  category: Category,
  raw: string | undefined | null,
  titleText?: string,
): string | null {
  const allowed = SUBCATEGORIES[category] ?? []

  const candidates = [raw, titleText].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    for (const sub of allowed) {
      // "t-shirts" normalises to "t shirts"; also try the singular form.
      const normalizedSub = normalizeText(sub)
      const singular = normalizedSub.replace(/s$/, '')
      if (containsTerm(text, normalizedSub) || containsTerm(text, singular)) return sub
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Gender
// ---------------------------------------------------------------------------

const GENDER_SYNONYMS: Record<string, Gender> = {
  women: 'women',
  woman: 'women',
  womens: 'women',
  female: 'women',
  ladies: 'women',
  men: 'men',
  man: 'men',
  mens: 'men',
  male: 'men',
  unisex: 'unisex',
  all: 'unisex',
  adult: 'unisex',
  kids: 'kids',
  kid: 'kids',
  children: 'kids',
  child: 'kids',
  boys: 'kids',
  girls: 'kids',
}

export function mapGender(raw: string | undefined | null): Gender | null {
  if (!raw) return null
  const text = normalizeText(raw)
  if (!text) return null
  if ((GENDERS as readonly string[]).includes(text)) return text as Gender
  if (GENDER_SYNONYMS[text]) return GENDER_SYNONYMS[text]
  for (const [term, gender] of Object.entries(GENDER_SYNONYMS)) {
    if (containsTerm(text, term)) return gender
  }
  return null
}

// ---------------------------------------------------------------------------
// Descriptive attributes
// ---------------------------------------------------------------------------

const COLOR_SYNONYMS: Record<string, string> = {
  charcoal: 'grey',
  gray: 'grey',
  slate: 'grey',
  ecru: 'cream',
  ivory: 'cream',
  offwhite: 'cream',
  'off white': 'cream',
  stone: 'beige',
  sand: 'beige',
  camel: 'tan',
  khaki: 'olive',
  chocolate: 'brown',
  wine: 'burgundy',
  maroon: 'burgundy',
  indigo: 'navy',
  midnight: 'navy',
  blush: 'pink',
  rose: 'pink',
  mustard: 'yellow',
  emerald: 'green',
  forest: 'green',
  lilac: 'purple',
  lavender: 'purple',
  multicolour: 'multi',
  multicolor: 'multi',
  printed: 'multi',
}

const MATERIAL_SYNONYMS: Record<string, string> = {
  merino: 'wool',
  lambswool: 'wool',
  'organic cotton': 'cotton',
  poplin: 'cotton',
  oxford: 'cotton',
  jersey: 'cotton',
  nylon: 'polyester',
  polyamide: 'polyester',
  'faux leather': 'leather',
  nubuck: 'suede',
  stainless: 'metal',
  steel: 'metal',
  brass: 'metal',
  porcelain: 'ceramic',
  stoneware: 'ceramic',
  oak: 'wood',
  walnut: 'wood',
  bamboo: 'wood',
}

const FIT_SYNONYMS: Record<string, string> = {
  'slim fit': 'slim',
  skinny: 'slim',
  fitted: 'slim',
  straight: 'regular',
  classic: 'regular',
  'regular fit': 'regular',
  loose: 'relaxed',
  'relaxed fit': 'relaxed',
  baggy: 'oversized',
  'oversized fit': 'oversized',
  cropped: 'boxy',
  slouchy: 'relaxed',
  'tailored fit': 'tailored',
}

const STYLE_SYNONYMS: Record<string, string> = {
  everyday: 'casual',
  smart: 'formal',
  business: 'formal',
  evening: 'formal',
  clean: 'minimal',
  scandi: 'minimal',
  street: 'streetwear',
  urban: 'streetwear',
  athletic: 'sporty',
  performance: 'sporty',
  retro: 'vintage',
  heritage: 'vintage',
  utility: 'workwear',
  boho: 'bohemian',
}

function mapVocabularyTerm(
  raw: string | undefined | null,
  allowed: readonly string[],
  synonyms: Record<string, string>,
): string | null {
  if (!raw) return null
  const text = normalizeText(raw)
  if (!text) return null

  if (allowed.includes(text)) return text
  if (synonyms[text] && allowed.includes(synonyms[text])) return synonyms[text]

  // Longest-first so "off white" beats "white" and "slim fit" beats "slim".
  const entries = [
    ...allowed.map((term) => [term, term] as const),
    ...Object.entries(synonyms),
  ].sort((a, b) => b[0].length - a[0].length)

  for (const [term, mapped] of entries) {
    if (containsTerm(text, term) && allowed.includes(mapped)) return mapped
  }
  return null
}

export const mapColor = (raw: string | undefined | null): string | null =>
  mapVocabularyTerm(raw, COLORS, COLOR_SYNONYMS)

export const mapMaterial = (raw: string | undefined | null): string | null =>
  mapVocabularyTerm(raw, MATERIALS, MATERIAL_SYNONYMS)

export const mapFit = (raw: string | undefined | null): string | null =>
  mapVocabularyTerm(raw, FITS, FIT_SYNONYMS)

export const mapStyle = (raw: string | undefined | null): string | null =>
  mapVocabularyTerm(raw, STYLES, STYLE_SYNONYMS)

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const AVAILABILITY_SYNONYMS: Record<string, Availability> = {
  'in stock': 'in_stock',
  instock: 'in_stock',
  available: 'in_stock',
  yes: 'in_stock',
  true: 'in_stock',
  'low stock': 'low_stock',
  limited: 'low_stock',
  'few left': 'low_stock',
  'out of stock': 'out_of_stock',
  outofstock: 'out_of_stock',
  unavailable: 'out_of_stock',
  soldout: 'out_of_stock',
  'sold out': 'out_of_stock',
  no: 'out_of_stock',
  false: 'out_of_stock',
  discontinued: 'discontinued',
  retired: 'discontinued',
}

/**
 * Map an availability string. Unknown values deliberately fall back to
 * `out_of_stock`: showing a user something they cannot buy is worse than
 * hiding something they could.
 */
export function mapAvailability(raw: string | undefined | null): Availability {
  if (!raw) return 'in_stock'
  const text = normalizeText(raw)
  if ((AVAILABILITY as readonly string[]).includes(text.replace(/ /g, '_'))) {
    return text.replace(/ /g, '_') as Availability
  }
  return AVAILABILITY_SYNONYMS[text] ?? 'out_of_stock'
}

/** Marketing noise that must not affect product identity. */
const TITLE_NOISE = [
  'new',
  'new in',
  'sale',
  'clearance',
  'limited edition',
  'exclusive',
  'best seller',
  'bestseller',
  'free shipping',
  'online only',
  'final sale',
]

/**
 * Clean a merchant title for *display*.
 *
 * Distinct from `canonicalizeTitle`, which exists to establish identity and so
 * deliberately destroys information — it strips colours and sizes and folds
 * "T-Shirt" into "tshirt" so two spellings collapse to one key. That output is
 * correct for matching and wrong for a product page.
 *
 * This keeps the merchant's own wording, casing and punctuation, and removes
 * only the brand (already shown separately in the UI) and marketing noise.
 */
export function displayTitle(title: string, brand?: string | null): string {
  let text = title.trim()

  if (brand?.trim()) {
    text = text.replace(new RegExp(escapeRegExp(brand.trim()), 'gi'), ' ')
  }

  for (const noise of TITLE_NOISE) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(noise)}\\b`, 'gi'), ' ')
  }

  text = text
    .replace(/\(\s*\)/g, '')
    .replace(/!+/g, '')
    .replace(/^[\s\-–—|,:]+/, '')
    .replace(/[\s\-–—|,:]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Never return an empty title just because the cleanup was aggressive.
  return text || title.trim()
}

/**
 * Reduce a merchant title to its identity-bearing words.
 *
 * Strips marketing noise, colour and size tokens, and the brand name, so that
 * "NEW! Aera Boxy Cotton Tee - Olive - M" and "Aera Boxy Cotton T-Shirt (Olive)"
 * collapse to the same string and can be recognised as one product.
 */
export function canonicalizeTitle(title: string, brand?: string | null): string {
  let text = normalizeText(title)

  if (brand) {
    const brandText = normalizeText(brand)
    if (brandText) text = text.replace(new RegExp(`(^| )${escapeRegExp(brandText)}( |$)`, 'g'), ' ')
  }

  for (const noise of TITLE_NOISE) {
    text = text.replace(new RegExp(`(^| )${escapeRegExp(noise)}( |$)`, 'g'), ' ')
  }
  for (const color of COLORS) {
    text = text.replace(new RegExp(`(^| )${escapeRegExp(color)}( |$)`, 'g'), ' ')
  }
  for (const size of ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '3xl', 'one size']) {
    text = text.replace(new RegExp(`(^| )${escapeRegExp(size)}( |$)`, 'g'), ' ')
  }

  // Common spelling variants that must not split identity.
  text = text
    .replace(/(^| )t shirt( |$)/g, ' tshirt ')
    .replace(/(^| )tee( |$)/g, ' tshirt ')
    .replace(/(^| )sweater( |$)/g, ' jumper ')

  return text.replace(/\s+/g, ' ').trim()
}
