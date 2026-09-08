# Deal engine

`lib/deals/engine.ts`. Pure, deterministic, and the one part of Bloom where
being wrong actively harms the user.

## Principles

1. **Deterministic.** Same inputs, same score, always. No model, no randomness.
2. **Evidence-gated.** A component with no evidence is dropped, not estimated.
3. **Missing data is stated, never filled in.** If there is no price history,
   the UI says there is no price history.

A language model is never involved in producing any number in this file.

## Inputs

Per merchant listing: `current_price`, `original_price` (only if the normalizer
accepted it as trustworthy), and every recorded `price_history` observation.

## Statistics

`computePriceStatistics()` produces:

| Field                              | Rule                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `discountFraction`                 | `(original - current) / original`, or `null` when there is no trustworthy original |
| `average30Day` / `average90Day`    | Mean over the window, **or `null`** below `MIN_OBSERVATIONS_FOR_AVERAGE` (3)       |
| `historicalLow` / `historicalHigh` | Min/max over all observations                                                      |
| `pricePercentile`                  | Where the current price sits between low and high, 0–1                             |
| `observationCount`                 | Distinct usable observations                                                       |
| `historyDays`                      | Span of the history                                                                |

Observations that are non-finite, zero or negative are discarded rather than
skewing the result.

## Scoring

Three components, each 0–1, weighted from `config/scoring.ts`:

| Component           | Weight | Evidence required                    |
| ------------------- | ------ | ------------------------------------ |
| `discountDepth`     | 0.40   | A trustworthy original price         |
| `vsRecentTypical`   | 0.35   | A 30- or 90-day average              |
| `nearHistoricalLow` | 0.25   | ≥3 observations and a non-flat price |

**Components without evidence are dropped and the remaining weights are
renormalised.** A product with no price history is scored on discount alone
rather than being silently penalised for our lack of data.

A discount at or above `DISCOUNT_SATURATION` (60%) saturates the discount
component. `vsRecentTypical` centres on 0.5, so a price _above_ its recent
typical scores below the midpoint rather than zero — being slightly expensive is
not the same as being terrible.

## When there is no evidence at all

The score is `NEUTRAL_SCORE` (50) and `limitedEvidence` is `true`.

Scoring an unknown price as "Poor" would be a claim we cannot support; scoring
it "Excellent" would be worse. **`DealBadge` refuses to render a band at all
when `limitedEvidence` is set** — it shows "Not enough price history" instead.
That check is the single most important line in the UI layer.

## Bands

| Score  | Band      |
| ------ | --------- |
| 0–39   | Poor      |
| 40–59  | Fair      |
| 60–74  | Good      |
| 75–89  | Great     |
| 90–100 | Excellent |

These are starting values chosen for plausibility, **not validated business
truth**. They live in `config/scoring.ts` so tuning never requires touching
scoring code. Expect them to move once real engagement data exists.

## Explanations

Every reason has a stable `code` (so copy can change without breaking
analytics), a `text`, and a `sentiment`. Each is derived from a specific
computed statistic:

```
Great deal                                     ← band, only when well-evidenced
↓ 28% below its original price of 125          ← discount_vs_original
↓ 19% below its 30-day typical price of 98     ← below_recent_typical
↓ Within 5% of its lowest recorded price       ← near_historical_low
```

And when the data is thin, that is the message:

```
Not enough price history
• We have not tracked this price long enough to judge the deal
```

Negative reasons are shown too — `above_recent_typical` tells a user this is a
_bad_ moment to buy. A tool that only ever says "buy now" is an advertisement.

## Language

Never claim: _best price_, _lowest price_, _guaranteed discount_, _best product_.

Bloom sees only the merchants it has ingested. A global "lowest price" claim
from a partial view is false, which is why `OfferList` compares merchants
without ever declaring a winner.

Say instead: _Great deal_, _Near recent low_, _X% below its recent typical
price_, _Matches your preferences_.

## Tests

`tests/unit/deal-engine.test.ts` covers, among others:

- no history → neutral score, `limitedEvidence`, and **no** fabricated
  `historicalLow` or `average30Day`
- fewer than three observations → averages withheld
- deep discount at a historical low → ≥75 with all three positive reason codes
- price above its recent typical → below 50, with a negative-sentiment reason
- discount-only evidence → weights renormalise to 100, but thin history is still
  disclosed
- identical inputs → identical output
