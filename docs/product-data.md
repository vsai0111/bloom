# Product data

## Current status: no live merchant feed

**No merchant API, affiliate feed, or data partnership has been contracted or
verified.** Bloom therefore runs on a hand-authored seed catalogue that enters
the system through exactly the same interface a real feed would use.

Everything downstream — normalization, matching, deal scoring, ranking, search —
is production code operating on that data. Only the source is synthetic.

See [What is needed from you](#what-is-needed-from-you) below.

## The pipeline

```
MerchantProvider.getProducts()      raw, merchant-shaped
        │
        ▼
normalizeProduct()                  validate → map → derive
        │                           (services/normalization)
        ├── reject with reasons ────► counted, logged, never silently dropped
        ▼
buildMatchKey()                     deterministic identity
        │
        ▼
persistProduct()                    upsert canonical product
        │                           upsert variants
        │                           upsert merchant listing
        ▼                           record price observation
    PostgreSQL
```

Run by `services/ingestion/pipeline.ts`. Failures are per-product: one malformed
listing in a feed of ten thousand must not abort the run, but it must also never
disappear quietly, so every rejection is counted and sampled into the run
summary.

## MerchantProvider

```ts
interface MerchantProvider {
  readonly id: string
  descriptor(): MerchantDescriptor
  getProducts(options?): Promise<ProductPage>
  getProduct(externalId): Promise<RawMerchantProduct | null>
  getPrices(externalIds): Promise<RawPrice[]>
  getAvailability(externalIds): Promise<RawAvailability[]>
  getAffiliateUrl(product, context): Promise<string | null>
}
```

Providers return **raw** data. They do not normalise, do not decide identity, and
do not touch the database. Keeping them dumb is what makes adding a merchant a
small, testable change.

Prices and availability are separate methods from `getProducts` because they are
re-polled far more often than the catalogue is re-crawled.

### The seed provider

`services/ingestion/providers/seed-provider.ts` is a full implementation, not a
stub. It paginates, and it deliberately emits _messy_ data — different category
vocabularies per merchant ("Apparel" / "Women > Clothing" / "Ready to Wear"),
string prices with currency symbols from one merchant and numbers from another,
inconsistent attribute key casing (`Colour` vs `color`), and marketing noise in
titles.

That matters: a seed provider that emitted clean data would leave the
normalization layer untested, and the first real feed would be the first time it
ran for real.

Not every merchant stocks every product (a deterministic ~72% per merchant), so
offer comparison is meaningful rather than every product having three identical
offers.

## Normalization

`services/normalization/` maps merchant vocabulary onto the controlled
vocabulary in `config/taxonomy.ts`. Entirely deterministic — a lookup table plus
whole-word matching. No model is consulted.

An unrecognised term returns `null` and records a warning. **A product with an
unknown colour is far better than a product confidently tagged the wrong
colour.**

What is normalised: category, subcategory, gender, colour, material, fit, style,
size, availability, price, currency, images.

Hard rejections — the product does not enter the catalogue:

| Rejection                             | Why                                                           |
| ------------------------------------- | ------------------------------------------------------------- |
| Missing/unparseable price             | A fabricated price is the worst possible error                |
| Missing brand                         | Brand anchors identity; guessing it merges unrelated products |
| Category cannot be mapped             | An unclassifiable product cannot be ranked or filtered        |
| `productUrl` is not absolute http(s)  | `javascript:` in an href is stored XSS                        |
| Title too short to establish identity | Better no product than a wrong merge                          |

Warnings — the product enters, the field does not:

- An "original price" at or below the current price (not a discount, bad data).
- An original price more than 20× the current price (usually a major/minor
  units mix-up).
- Image URLs with unsafe schemes.
- Unrecognised colour, material, fit or subcategory.

Unrecognised availability maps to `out_of_stock`, not `in_stock`. Showing
someone something they cannot buy is worse than hiding something they could.

### Prices

`services/normalization/price.ts` handles `"1,299.00"`, `"1.299,00"`,
`"1299,00"`, `"$45.99"`, `"USD 30"` and plain numbers, and **refuses ambiguity**
rather than guessing. It rejects negatives, non-finite values, and anything above
a plausibility ceiling.

Nothing here is ever produced by a language model. See
[AI usage](#ai-usage).

## Product matching

Identity is decided by `buildMatchKey()`, stored on `products.match_key` with a
unique constraint. Three strategies, in descending order of trust:

| Strategy                                         | Key                     | Confidence |
| ------------------------------------------------ | ----------------------- | ---------- |
| Valid GTIN/EAN/UPC (mod-10 check digit verified) | `gtin:<digits>`         | High       |
| Brand + manufacturer part number (≥4 chars)      | `mpn:<brand>:<mpn>`     | High       |
| Brand + canonicalised title                      | `title:<brand>:<title>` | Medium     |

The strategy name is part of the key, so a product identified by GTIN can never
collide with one identified by title.

Title canonicalisation strips marketing noise, colour and size tokens, and the
brand name, then normalises common spelling variants, so that:

```
"NEW! Aera Boxy Cotton Tee - Olive - M"   ┐
                                           ├─► title:aera:boxy-cotton-tshirt
"Aera Boxy Cotton T-Shirt (Olive)"        ┘
```

There is **no fuzzy matching**, no similarity threshold, and no embedding
comparison. Every rule is an exact match on a deterministic key.

> **Incorrect matching is worse than incomplete matching.** A user shown "3
> merchants" for products that are not actually the same is being actively
> misinformed about price.

This is not theoretical. During development `findMpn` accepted a bare `style`
attribute key; feeds commonly send `style: "minimal"`, so every minimal-styled
product from a brand collapsed into one canonical product — 36 products where
there should have been 46. Caught by asserting that no canonical product can
have more listings than there are merchants. That assertion is now a permanent
test, and `findMpn` accepts `styleCode`/`styleNumber` but never bare `style`.

## AI usage

AI may be used for extracting attributes from unstructured descriptions,
interpreting free text, and future natural-language search.

AI is **never** the source of truth for:

- prices, discounts, historical prices
- availability
- product identity or merchant identity
- any financial calculation

No part of the current pipeline calls a model. If that changes, output must be
validated against `config/taxonomy.ts` before persistence, exactly as merchant
data is.

## Adding a real merchant

1. Implement `MerchantProvider` in `services/ingestion/providers/`.
2. Add its hostnames to the merchant's `allowed_hosts` — outbound redirects are
   refused otherwise, and this fails closed.
3. Add its image hostnames to `images.remotePatterns` in `next.config.ts`.
4. Register it in the ingestion runner.
5. Add a normalization test with real sample rows from the feed.

Nothing else changes. The rest of the application does not know where a product
came from.

**Do not scrape.** Only use feeds and APIs the source's terms permit.

## What is needed from you

To move from seed data to real products:

1. **An affiliate network account or direct merchant agreement** — Bloom cannot
   sign up for one. This is the blocking dependency.
2. **Feed or API credentials**, plus documentation of the format.
3. **Confirmation of the terms of use**, specifically whether caching product
   data and displaying price history is permitted.

Until then the seed catalogue is the development and demonstration dataset, and
every price in it is synthetic. Price history rows generated for it are written
with `source = 'seed'` so they remain distinguishable from real observations
forever, and can be deleted wholesale when real data arrives.
