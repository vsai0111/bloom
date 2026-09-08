/**
 * The seed catalogue.
 *
 * Bloom has no contracted merchant feed yet (see docs/product-data.md), so this
 * hand-authored catalogue is what the entire product is developed and tested
 * against. It is deliberately realistic — plausible brands, prices, materials
 * and attribute spreads — because a recommendation engine tuned against toy
 * data tells you nothing about whether it works.
 *
 * Every brand and merchant name here is FICTIONAL. Using real retailer or brand
 * names in seed data would create a trademark problem and would also imply
 * commercial relationships that do not exist.
 *
 * This data enters the system through `SeedMerchantProvider`, i.e. through
 * exactly the same provider interface a real merchant feed would use. Nothing
 * downstream knows the catalogue is seeded.
 */

export interface SeedMerchant {
  name: string
  slug: string
  websiteUrl: string
  allowedHosts: string[]
  /** Multiplier applied to a product's base price for this merchant's listing. */
  priceFactor: number
  /** Fraction of this merchant's listings that carry a discount. */
  discountRate: number
}

export const SEED_MERCHANTS: SeedMerchant[] = [
  {
    name: 'Northwind Supply',
    slug: 'northwind-supply',
    websiteUrl: 'https://shop.northwind-supply.example',
    allowedHosts: ['shop.northwind-supply.example', 'northwind-supply.example'],
    priceFactor: 1.0,
    discountRate: 0.45,
  },
  {
    name: 'Meridian Goods',
    slug: 'meridian-goods',
    websiteUrl: 'https://meridian-goods.example',
    allowedHosts: ['meridian-goods.example', 'www.meridian-goods.example'],
    priceFactor: 1.08,
    discountRate: 0.3,
  },
  {
    name: 'The Lark Store',
    slug: 'lark-store',
    websiteUrl: 'https://larkstore.example',
    allowedHosts: ['larkstore.example', 'cdn.larkstore.example'],
    priceFactor: 0.94,
    discountRate: 0.55,
  },
]

export interface SeedProduct {
  brand: string
  title: string
  category: 'clothing' | 'shoes' | 'accessories' | 'home' | 'electronics'
  subcategory: string
  gender?: 'women' | 'men' | 'unisex' | 'kids'
  color: string
  material?: string
  fit?: string
  style?: string
  /** Reference price in USD before per-merchant adjustment. */
  basePrice: number
  /** Manufacturer part number, when this product has one. */
  mpn?: string
  /** Valid GTIN, for products where two merchants should confidently merge. */
  gtin?: string
  sizes?: string[]
  description: string
  /** Merchant slugs that stock this product. Defaults to all merchants. */
  merchants?: string[]
}

/**
 * Sizes reused across clothing entries.
 */
const APPAREL = ['XS', 'S', 'M', 'L', 'XL']
const SHOE = ['7', '8', '9', '10', '11', '12']

export const SEED_PRODUCTS: SeedProduct[] = [
  // ---------------------------------------------------------------- clothing
  {
    brand: 'Aera',
    title: 'Boxy Cotton T-Shirt',
    category: 'clothing',
    subcategory: 't-shirts',
    gender: 'women',
    color: 'olive',
    material: 'cotton',
    fit: 'boxy',
    style: 'minimal',
    basePrice: 42,
    // Shared GTIN: this product is stocked by two merchants and must resolve to
    // a single canonical product, which is what makes the offer comparison real.
    gtin: '4006381333931',
    sizes: APPAREL,
    description:
      'A heavyweight cotton tee cut with a square, boxy body and a slightly dropped shoulder. Garment-dyed for a soft, lived-in finish.',
  },
  {
    brand: 'Aera',
    title: 'Relaxed Linen Shirt',
    category: 'clothing',
    subcategory: 'shirts',
    gender: 'women',
    color: 'cream',
    material: 'linen',
    fit: 'relaxed',
    style: 'minimal',
    basePrice: 88,
    mpn: 'AE-LSH-114',
    sizes: APPAREL,
    description:
      'Washed European linen with a relaxed body, a camp collar and a single patch pocket. Breathable enough for high summer.',
  },
  {
    brand: 'Aera',
    title: 'Wide Leg Cotton Trousers',
    category: 'clothing',
    subcategory: 'trousers',
    gender: 'women',
    color: 'black',
    material: 'cotton',
    fit: 'relaxed',
    style: 'minimal',
    basePrice: 96,
    sizes: APPAREL,
    description:
      'A high-rise trouser with a wide, straight leg and a clean front. Cut from a substantial cotton twill that holds its shape.',
  },
  {
    brand: 'Nordfelt',
    title: 'Merino Crew Jumper',
    category: 'clothing',
    subcategory: 'knitwear',
    gender: 'unisex',
    color: 'navy',
    material: 'wool',
    fit: 'regular',
    style: 'minimal',
    basePrice: 145,
    mpn: 'NF-KNT-2201',
    sizes: APPAREL,
    description:
      'Fine-gauge merino in a classic crew neck. Warm without bulk, and light enough to layer under a coat.',
  },
  {
    brand: 'Nordfelt',
    title: 'Wool Overcoat',
    category: 'clothing',
    subcategory: 'coats',
    gender: 'men',
    color: 'grey',
    material: 'wool',
    fit: 'tailored',
    style: 'formal',
    basePrice: 420,
    mpn: 'NF-COAT-2201',
    gtin: '5012345678900',
    sizes: APPAREL,
    description:
      'A single-breasted overcoat in a wool-rich melton, with a half-canvas chest and a deep back vent.',
  },
  {
    brand: 'Nordfelt',
    title: 'Structured Wool Blazer',
    category: 'clothing',
    subcategory: 'jackets',
    gender: 'women',
    color: 'burgundy',
    material: 'wool',
    fit: 'tailored',
    style: 'formal',
    basePrice: 285,
    sizes: APPAREL,
    description:
      'A softly structured blazer with a two-button front and functional cuffs. Lined in cupro for an easy layer.',
  },
  {
    brand: 'Pike & Post',
    title: 'Selvedge Denim Jeans',
    category: 'clothing',
    subcategory: 'jeans',
    gender: 'men',
    color: 'blue',
    material: 'denim',
    fit: 'slim',
    style: 'casual',
    basePrice: 128,
    mpn: 'PP-DNM-5501',
    sizes: APPAREL,
    description:
      'Raw selvedge denim woven on shuttle looms, cut slim through the leg with a mid rise. Will fade to your wear pattern.',
  },
  {
    brand: 'Pike & Post',
    title: 'Waxed Cotton Field Jacket',
    category: 'clothing',
    subcategory: 'jackets',
    gender: 'men',
    color: 'olive',
    material: 'cotton',
    fit: 'regular',
    style: 'workwear',
    basePrice: 245,
    sizes: APPAREL,
    description:
      'A four-pocket field jacket in waxed cotton, with a corduroy collar and a storm flap over the zip.',
  },
  {
    brand: 'Pike & Post',
    title: 'Heavyweight Flannel Shirt',
    category: 'clothing',
    subcategory: 'shirts',
    gender: 'men',
    color: 'green',
    material: 'cotton',
    fit: 'relaxed',
    style: 'workwear',
    basePrice: 92,
    sizes: APPAREL,
    description:
      'Brushed cotton flannel in a muted check, cut with room through the body and a curved hem.',
  },
  {
    brand: 'Marlowe Grey',
    title: 'Silk Slip Dress',
    category: 'clothing',
    subcategory: 'dresses',
    gender: 'women',
    color: 'black',
    material: 'silk',
    fit: 'slim',
    style: 'formal',
    basePrice: 198,
    sizes: APPAREL,
    description:
      'A bias-cut slip in sandwashed silk, with adjustable straps and a low back. Falls just below the calf.',
  },
  {
    brand: 'Marlowe Grey',
    title: 'Pleated Midi Skirt',
    category: 'clothing',
    subcategory: 'skirts',
    gender: 'women',
    color: 'olive',
    material: 'polyester',
    fit: 'regular',
    style: 'minimal',
    basePrice: 115,
    sizes: APPAREL,
    description:
      'Knife pleats in a fluid crepe, set on a grosgrain waistband. Holds its pleat through washing.',
  },
  {
    brand: 'Marlowe Grey',
    title: 'Cashmere Wrap Cardigan',
    category: 'clothing',
    subcategory: 'knitwear',
    gender: 'women',
    color: 'beige',
    material: 'cashmere',
    fit: 'oversized',
    style: 'minimal',
    basePrice: 320,
    gtin: '4012345678901',
    sizes: APPAREL,
    description:
      'Grade-A cashmere in an oversized wrap shape with a tie belt and deep patch pockets.',
  },
  {
    brand: 'Rills',
    title: 'Organic Cotton Hoodie',
    category: 'clothing',
    subcategory: 'knitwear',
    gender: 'unisex',
    color: 'grey',
    material: 'cotton',
    fit: 'oversized',
    style: 'streetwear',
    basePrice: 78,
    sizes: APPAREL,
    description:
      'A heavyweight loopback hoodie in organic cotton, with a double-layer hood and ribbed cuffs.',
  },
  {
    brand: 'Rills',
    title: 'Cropped Puffer Jacket',
    category: 'clothing',
    subcategory: 'jackets',
    gender: 'women',
    color: 'silver',
    material: 'polyester',
    fit: 'boxy',
    style: 'streetwear',
    basePrice: 165,
    sizes: APPAREL,
    description:
      'A cropped, boxy puffer with recycled insulation and a high funnel neck. Water-repellent shell.',
  },
  {
    brand: 'Rills',
    title: 'Ripstop Cargo Trousers',
    category: 'clothing',
    subcategory: 'trousers',
    gender: 'unisex',
    color: 'black',
    material: 'cotton',
    fit: 'relaxed',
    style: 'streetwear',
    basePrice: 110,
    sizes: APPAREL,
    description:
      'Relaxed cargo trousers in a ripstop cotton, with bellowed thigh pockets and an adjustable hem.',
  },
  {
    brand: 'Tenby',
    title: 'Performance Running Tee',
    category: 'clothing',
    subcategory: 'activewear',
    gender: 'men',
    color: 'blue',
    material: 'polyester',
    fit: 'slim',
    style: 'sporty',
    basePrice: 48,
    sizes: APPAREL,
    description:
      'A lightweight running tee in a recycled knit with laser-cut ventilation and flat-locked seams.',
  },
  {
    brand: 'Tenby',
    title: 'Training Shorts',
    category: 'clothing',
    subcategory: 'shorts',
    gender: 'men',
    color: 'black',
    material: 'polyester',
    fit: 'regular',
    style: 'sporty',
    basePrice: 55,
    sizes: APPAREL,
    description:
      'Seven-inch training shorts with a bonded waistband, a zip pocket and a built-in liner.',
  },
  {
    brand: 'Sundowne',
    title: 'Vintage Wash Denim Jacket',
    category: 'clothing',
    subcategory: 'jackets',
    gender: 'unisex',
    color: 'blue',
    material: 'denim',
    fit: 'boxy',
    style: 'vintage',
    basePrice: 138,
    sizes: APPAREL,
    description:
      'A boxy trucker jacket in a stonewashed rigid denim, with pointed flap pockets and a cropped body.',
  },
  {
    brand: 'Sundowne',
    title: 'Printed Rayon Maxi Dress',
    category: 'clothing',
    subcategory: 'dresses',
    gender: 'women',
    color: 'multi',
    material: 'polyester',
    fit: 'relaxed',
    style: 'bohemian',
    basePrice: 125,
    sizes: APPAREL,
    description: 'A floor-length dress in a fluid rayon with a tiered skirt and a smocked bodice.',
  },

  // ------------------------------------------------------------------- shoes
  {
    brand: 'Halden',
    title: 'Leather Chelsea Boots',
    category: 'shoes',
    subcategory: 'boots',
    gender: 'women',
    color: 'brown',
    material: 'leather',
    style: 'minimal',
    basePrice: 235,
    mpn: 'HD-CHB-880',
    gtin: '4006381333948',
    sizes: SHOE,
    description:
      'Goodyear-welted Chelsea boots in full-grain leather, on a stacked leather heel with elastic side gussets.',
  },
  {
    brand: 'Halden',
    title: 'Suede Penny Loafers',
    category: 'shoes',
    subcategory: 'loafers',
    gender: 'men',
    color: 'tan',
    material: 'suede',
    style: 'formal',
    basePrice: 210,
    sizes: SHOE,
    description: 'Unlined suede loafers with a hand-stitched apron and a flexible leather sole.',
  },
  {
    brand: 'Kestrel',
    title: 'Court Sneakers',
    category: 'shoes',
    subcategory: 'sneakers',
    gender: 'unisex',
    color: 'white',
    material: 'leather',
    style: 'minimal',
    basePrice: 120,
    mpn: 'KS-CRT-101',
    sizes: SHOE,
    description:
      'A clean leather court sneaker on a vulcanised rubber cup sole, with a padded collar.',
  },
  {
    brand: 'Kestrel',
    title: 'Trail Running Shoes',
    category: 'shoes',
    subcategory: 'running-shoes',
    gender: 'men',
    color: 'orange',
    material: 'polyester',
    style: 'sporty',
    basePrice: 155,
    sizes: SHOE,
    description:
      'A cushioned trail shoe with a rock plate, a 6mm drop and an aggressive lugged outsole.',
  },
  {
    brand: 'Kestrel',
    title: 'Everyday Runner',
    category: 'shoes',
    subcategory: 'running-shoes',
    gender: 'women',
    color: 'pink',
    material: 'polyester',
    style: 'sporty',
    basePrice: 135,
    sizes: SHOE,
    description:
      'A neutral daily trainer with a resilient foam midsole and an engineered mesh upper.',
  },
  {
    brand: 'Voss Atelier',
    title: 'Leather Sandals',
    category: 'shoes',
    subcategory: 'sandals',
    gender: 'women',
    color: 'black',
    material: 'leather',
    style: 'minimal',
    basePrice: 165,
    sizes: SHOE,
    description:
      'A two-strap sandal in vegetable-tanned leather with a moulded footbed and a low block heel.',
  },
  {
    brand: 'Voss Atelier',
    title: 'Oxford Dress Shoes',
    category: 'shoes',
    subcategory: 'formal-shoes',
    gender: 'men',
    color: 'black',
    material: 'leather',
    style: 'formal',
    basePrice: 340,
    sizes: SHOE,
    description: 'A closed-lacing Oxford in box calf, Goodyear-welted onto a single leather sole.',
  },

  // ------------------------------------------------------------ accessories
  {
    brand: 'Colmar & Vale',
    title: 'Leather Tote Bag',
    category: 'accessories',
    subcategory: 'bags',
    gender: 'women',
    color: 'tan',
    material: 'leather',
    style: 'minimal',
    basePrice: 295,
    mpn: 'CV-TOTE-40',
    gtin: '5012345678917',
    description:
      'An unstructured tote in vegetable-tanned leather, with a magnetic closure and an internal zip pocket.',
  },
  {
    brand: 'Colmar & Vale',
    title: 'Bifold Leather Wallet',
    category: 'accessories',
    subcategory: 'wallets',
    gender: 'unisex',
    color: 'brown',
    material: 'leather',
    style: 'minimal',
    basePrice: 95,
    description:
      'A slim bifold in full-grain leather with six card slots and a full-length note pocket.',
  },
  {
    brand: 'Colmar & Vale',
    title: 'Woven Leather Belt',
    category: 'accessories',
    subcategory: 'belts',
    gender: 'men',
    color: 'brown',
    material: 'leather',
    style: 'casual',
    basePrice: 78,
    description:
      'A woven leather belt with a solid brass buckle, adjustable anywhere along its length.',
  },
  {
    brand: 'Öland',
    title: 'Automatic Field Watch',
    category: 'accessories',
    subcategory: 'watches',
    gender: 'unisex',
    color: 'green',
    material: 'metal',
    style: 'workwear',
    basePrice: 480,
    mpn: 'OL-FLD-38A',
    description:
      'A 38mm field watch on a Swiss automatic movement, with a sapphire crystal and 100m water resistance.',
  },
  {
    brand: 'Öland',
    title: 'Acetate Sunglasses',
    category: 'accessories',
    subcategory: 'sunglasses',
    gender: 'unisex',
    color: 'black',
    material: 'plastic',
    style: 'minimal',
    basePrice: 165,
    description:
      'Hand-polished acetate frames with CR-39 polarised lenses and Japanese titanium hinges.',
  },
  {
    brand: 'Marlowe Grey',
    title: 'Cashmere Scarf',
    category: 'accessories',
    subcategory: 'scarves',
    gender: 'women',
    color: 'cream',
    material: 'cashmere',
    style: 'minimal',
    basePrice: 145,
    description:
      'A generously sized cashmere scarf with hand-knotted fringing and a brushed finish.',
  },
  {
    brand: 'Öland',
    title: 'Signet Ring',
    category: 'accessories',
    subcategory: 'jewellery',
    gender: 'unisex',
    color: 'gold',
    material: 'metal',
    style: 'minimal',
    basePrice: 220,
    description: 'A solid brass signet with a gold finish and a flat, engravable face.',
  },

  // -------------------------------------------------------------------- home
  {
    brand: 'Hearth & Fell',
    title: 'Linen Duvet Set',
    category: 'home',
    subcategory: 'bedding',
    color: 'beige',
    material: 'linen',
    style: 'minimal',
    basePrice: 210,
    mpn: 'HF-BED-QN',
    description:
      'Stonewashed French flax linen in a duvet cover and two pillowcases. Softens with every wash.',
  },
  {
    brand: 'Hearth & Fell',
    title: 'Waffle Cotton Throw',
    category: 'home',
    subcategory: 'textiles',
    color: 'grey',
    material: 'cotton',
    style: 'minimal',
    basePrice: 88,
    description: 'A generous waffle-weave throw in long-staple cotton, with a hand-knotted fringe.',
  },
  {
    brand: 'Hearth & Fell',
    title: 'Ceramic Table Lamp',
    category: 'home',
    subcategory: 'lighting',
    color: 'white',
    material: 'ceramic',
    style: 'minimal',
    basePrice: 165,
    gtin: '4012345678918',
    description: 'A hand-thrown ceramic base with a linen drum shade and an inline dimmer switch.',
  },
  {
    brand: 'Brockway',
    title: 'Cast Iron Skillet',
    category: 'home',
    subcategory: 'cookware',
    color: 'black',
    material: 'metal',
    style: 'workwear',
    basePrice: 95,
    mpn: 'BW-CI-12',
    description:
      'A pre-seasoned 12-inch cast iron skillet with a machined cooking surface and a helper handle.',
  },
  {
    brand: 'Brockway',
    title: 'Stoneware Mug Set',
    category: 'home',
    subcategory: 'cookware',
    color: 'blue',
    material: 'ceramic',
    style: 'casual',
    basePrice: 62,
    description:
      'A set of four reactive-glazed stoneware mugs. Each one glazes slightly differently.',
  },
  {
    brand: 'Brockway',
    title: 'Oak Storage Box',
    category: 'home',
    subcategory: 'storage',
    color: 'brown',
    material: 'wood',
    style: 'minimal',
    basePrice: 130,
    description: 'A dovetailed white oak box with a sliding lid and a hand-rubbed oil finish.',
  },
  {
    brand: 'Hearth & Fell',
    title: 'Framed Botanical Print',
    category: 'home',
    subcategory: 'decor',
    color: 'green',
    material: 'wood',
    style: 'vintage',
    basePrice: 74,
    description: 'A giclée botanical study on cotton rag paper, framed in solid ash behind glass.',
  },

  // ------------------------------------------------------------- electronics
  {
    brand: 'Aurel Audio',
    title: 'Wireless Noise Cancelling Headphones',
    category: 'electronics',
    subcategory: 'headphones',
    color: 'black',
    material: 'plastic',
    style: 'minimal',
    basePrice: 349,
    mpn: 'AU-NC-700',
    gtin: '5012345678924',
    description:
      'Over-ear headphones with adaptive noise cancelling, 30-hour battery life and multipoint pairing.',
  },
  {
    brand: 'Aurel Audio',
    title: 'True Wireless Earbuds',
    category: 'electronics',
    subcategory: 'headphones',
    color: 'white',
    material: 'plastic',
    style: 'minimal',
    basePrice: 179,
    mpn: 'AU-TW-220',
    description:
      'Compact earbuds with active noise cancelling, wireless charging and an IPX4 rating.',
  },
  {
    brand: 'Aurel Audio',
    title: 'Portable Bluetooth Speaker',
    category: 'electronics',
    subcategory: 'speakers',
    color: 'olive',
    material: 'plastic',
    style: 'sporty',
    basePrice: 129,
    description:
      'A rugged IP67 speaker with a passive radiator, 18-hour playback and USB-C charging.',
  },
  {
    brand: 'Quill Devices',
    title: 'Mechanical Keyboard 75%',
    category: 'electronics',
    subcategory: 'keyboards',
    color: 'grey',
    material: 'aluminium',
    style: 'minimal',
    basePrice: 189,
    mpn: 'QD-KB-75',
    description:
      'A gasket-mounted 75% keyboard in a CNC aluminium case, hot-swappable and QMK-compatible.',
  },
  {
    brand: 'Quill Devices',
    title: 'USB-C GaN Charger 65W',
    category: 'electronics',
    subcategory: 'chargers',
    color: 'white',
    material: 'plastic',
    style: 'minimal',
    basePrice: 59,
    description: 'A compact 65W GaN charger with two USB-C ports and foldable pins.',
  },
  {
    brand: 'Quill Devices',
    title: 'Fitness Tracker Band',
    category: 'electronics',
    subcategory: 'wearables',
    color: 'black',
    material: 'plastic',
    style: 'sporty',
    basePrice: 99,
    description:
      'A lightweight tracker with continuous heart rate, sleep staging and a seven-day battery.',
  },
  {
    brand: 'Aurel Audio',
    title: 'Compact Mirrorless Camera',
    category: 'electronics',
    subcategory: 'cameras',
    color: 'silver',
    material: 'metal',
    style: 'vintage',
    basePrice: 899,
    mpn: 'AU-CAM-X1',
    description:
      'A 26MP APS-C mirrorless body with in-body stabilisation, a tilting screen and dial-led controls.',
  },
]
