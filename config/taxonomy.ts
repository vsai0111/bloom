/**
 * Bloom's controlled vocabulary.
 *
 * Merchant feeds are messy and inconsistent. Every incoming product is mapped
 * onto the terms defined here during normalization (see services/normalization),
 * so that preferences, filters and recommendation scoring can compare products
 * from different merchants on equal terms.
 *
 * Adding a term is safe. Renaming or removing one requires a data migration.
 */

export const CATEGORIES = ['clothing', 'shoes', 'accessories', 'home', 'electronics'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  clothing: 'Clothing',
  shoes: 'Shoes',
  accessories: 'Accessories',
  home: 'Home',
  electronics: 'Electronics',
}

export const SUBCATEGORIES: Record<Category, readonly string[]> = {
  clothing: [
    'shirts',
    't-shirts',
    'trousers',
    'jeans',
    'dresses',
    'knitwear',
    'jackets',
    'coats',
    'shorts',
    'skirts',
    'activewear',
  ],
  shoes: ['sneakers', 'boots', 'loafers', 'sandals', 'formal-shoes', 'running-shoes'],
  accessories: ['bags', 'belts', 'watches', 'sunglasses', 'scarves', 'wallets', 'jewellery'],
  home: ['bedding', 'lighting', 'cookware', 'storage', 'decor', 'textiles'],
  electronics: ['headphones', 'speakers', 'wearables', 'keyboards', 'cameras', 'chargers'],
} as const

export const GENDERS = ['women', 'men', 'unisex', 'kids'] as const
export type Gender = (typeof GENDERS)[number]

/** Attributes users can express a preference over, and products are tagged with. */
export const PREFERENCE_ATTRIBUTES = [
  // `category` is the highest-signal preference of all — it is what onboarding
  // asks first and what candidate generation filters on. It must be listed here
  // or every category answer is silently discarded.
  'category',
  'fit',
  'style',
  'material',
  'color',
  'brand',
  'subcategory',
  'price_band',
] as const
export type PreferenceAttribute = (typeof PREFERENCE_ATTRIBUTES)[number]

/**
 * Attributes whose preferences are scoped to a category rather than global.
 *
 * "I like olive" is a statement about the user, and holds across everything they
 * shop for. "I like t-shirts" only means anything inside clothing.
 *
 * Both onboarding and behavioural learning consult this, so the same taste
 * always lands on the same row. Without a shared rule, onboarding writing a
 * global preference and learning writing a category-scoped one produces two
 * near-duplicate rows for one taste, which is confusing on the preferences page
 * and double-counts nothing useful in scoring.
 */
export const CATEGORY_SCOPED_ATTRIBUTES: ReadonlySet<string> = new Set(['subcategory'])

export function scopeForAttribute(attribute: string, category: string | null): string | null {
  return CATEGORY_SCOPED_ATTRIBUTES.has(attribute) ? category : null
}

export const FITS = ['slim', 'regular', 'relaxed', 'boxy', 'oversized', 'tailored'] as const
export const STYLES = [
  'casual',
  'formal',
  'minimal',
  'streetwear',
  'sporty',
  'vintage',
  'workwear',
  'bohemian',
] as const
export const MATERIALS = [
  'cotton',
  'linen',
  'wool',
  'cashmere',
  'denim',
  'leather',
  'silk',
  'polyester',
  'canvas',
  'suede',
  'ceramic',
  'glass',
  'wood',
  'metal',
  'aluminium',
  'plastic',
] as const
export const COLORS = [
  'black',
  'white',
  'grey',
  'navy',
  'blue',
  'green',
  'olive',
  'beige',
  'cream',
  'brown',
  'tan',
  'red',
  'burgundy',
  'pink',
  'purple',
  'yellow',
  'orange',
  'silver',
  'gold',
  'multi',
] as const

export type Fit = (typeof FITS)[number]
export type Style = (typeof STYLES)[number]
export type Material = (typeof MATERIALS)[number]
export type Color = (typeof COLORS)[number]

export const CLOTHING_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const
export const SHOE_SIZES = ['5', '6', '7', '8', '9', '10', '11', '12', '13'] as const
export const ONE_SIZE = 'One Size'

/**
 * Coarse price bands, in minor units of the display currency. Used for the
 * "price fit" component of recommendation scoring and as an onboarding question
 * that is much easier to answer than an exact budget.
 */
export const PRICE_BANDS = [
  { id: 'budget', label: 'Under 50', min: 0, max: 50 },
  { id: 'mid', label: '50 - 150', min: 50, max: 150 },
  { id: 'premium', label: '150 - 400', min: 150, max: 400 },
  { id: 'luxury', label: '400+', min: 400, max: Number.MAX_SAFE_INTEGER },
] as const
export type PriceBandId = (typeof PRICE_BANDS)[number]['id']

export function priceBandFor(amount: number): PriceBandId {
  const band = PRICE_BANDS.find((b) => amount >= b.min && amount < b.max)
  return (band ?? PRICE_BANDS[PRICE_BANDS.length - 1]).id
}

export const AVAILABILITY = ['in_stock', 'low_stock', 'out_of_stock', 'discontinued'] as const
export type Availability = (typeof AVAILABILITY)[number]

/** Vocabulary lookup used by the normalizer to validate a candidate value. */
export const ATTRIBUTE_VOCABULARY: Record<string, readonly string[]> = {
  fit: FITS,
  style: STYLES,
  material: MATERIALS,
  color: COLORS,
  category: CATEGORIES,
  gender: GENDERS,
  availability: AVAILABILITY,
  price_band: PRICE_BANDS.map((b) => b.id),
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value)
}

export function subcategoriesFor(category: Category): readonly string[] {
  return SUBCATEGORIES[category] ?? []
}
