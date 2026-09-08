# Recommendations

The core intellectual component. Deterministic, explainable, and tuned by data
in `config/scoring.ts` rather than by editing logic.

## Pipeline

```
candidate products        SQL: in stock, active merchant, not rejected,
        │                      in the user's categories (if stated), cap 300
        ▼
eligibility               already applied in the query
        ▼
scoring                   six independent components, in TypeScript
        ▼
ranking                   weighted blend, stable tiebreak
        ▼
diversity                 brand / subcategory caps, brand spacing
        ▼
feed sections             only sections with enough content
```

Candidate generation is SQL; scoring and diversity are in memory over a bounded
candidate set. At Phase 1 catalogue size that is the right trade — it keeps all
ranking logic in testable TypeScript instead of spread across SQL. The 300-item
cap is the knob that keeps it honest as the catalogue grows; past a few thousand
products, scoring moves into the query or into a precomputed table.

## Scoring components

| Component           | Weight | Behaviour with no relevant preference      |
| ------------------- | ------ | ------------------------------------------ |
| `preferenceMatch`   | 0.40   | 0.5 (neutral)                              |
| `categoryRelevance` | 0.20   | 0.5                                        |
| `priceFit`          | 0.15   | 0.5                                        |
| `brandAffinity`     | 0.10   | 0.5                                        |
| `dealQuality`       | 0.10   | deal score / 100                           |
| `availability`      | 0.05   | in stock 1.0 · low stock 0.8 · otherwise 0 |

Each is computed independently and returned alongside the total, which is what
lets the product page show its arithmetic.

### Preference matching is grouped

Preferences are grouped by attribute, and each group scores on its **best match
relative to its strongest preference**.

This matters. A user who likes olive, navy and black should not have an olive
product score 1/3 for colour. Grouping gives it 1.0. Without grouping, stating
more preferences would make every product score worse — the system would punish
users for telling it more.

### Non-matches are not zeroed

An unfamiliar brand scores 0.4, not 0. A non-matching category scores 0.15, not 0. Hard zeros make discovery impossible: a user would only ever be shown brands
they had already named, which defeats the purpose of a discovery product.

### Scoped preferences

A preference with a `category` only applies to products in that category. A
clothing-scoped "boxy fit" preference does not drag down a pair of headphones —
it is simply not applicable, and contributes nothing either way.

## Learning from behaviour

`lib/preferences/repository.ts`, `learnFromSignal()`.

| Signal           | Weight delta |
| ---------------- | ------------ |
| `product_save`   | +0.12        |
| `merchant_click` | +0.10        |
| `product_like`   | +0.08        |
| `search`         | +0.02        |
| `product_view`   | +0.015       |
| `product_reject` | −0.15        |

Rules, deliberately simple enough to state in a sentence each:

- **Explicit beats behavioural.** Something the user said outranks something we
  inferred. `PREFERENCE_SOURCE_WEIGHTS` starts explicit at 1.0 and behavioural
  at 0.5, and a behavioural signal never rewrites an explicit preference's
  source.
- **Weak evidence must repeat.** A behaviourally-learned preference does not
  influence ranking until `signal_count >= BEHAVIORAL_PREFERENCE_THRESHOLD` (2).
  One curious click is not a stated taste. `listActivePreferences()` enforces
  this; `listPreferences()` shows everything, including the not-yet-active rows.
- **Weights are bounded** to [0.05, 1.0], so no single signal can dominate.
- **Rejection prunes.** A behavioural preference pushed to the floor by repeated
  rejection is deleted rather than lingering at zero.

Rejecting a product also removes it from saved and liked, and excludes it from
every future feed section.

## Diversity

`lib/recommendations/diversity.ts`. Pure ranking produces feeds that are
technically optimal and useless to look at — twenty near-identical olive tees
from one brand.

Caps from `config/scoring.ts`: `maxPerBrand: 3`, `maxPerSubcategory: 4`,
`minBrandGap: 2`.

A greedy single pass, chosen for predictability over optimality. Items that
violate a constraint are deferred, then backfilled if room remains — with the
hard caps still applied but the _spacing_ rule relaxed, because spacing is a
presentation nicety and a short feed is not.

The same canonical product can never appear twice in one section.

## Feed sections

| Section              | Included when                                              |
| -------------------- | ---------------------------------------------------------- |
| For you              | ≥4 ranked candidates                                       |
| Good deals right now | ≥4 with deal score ≥75 **and** `limitedEvidence === false` |
| Because you like _X_ | ≥4 matching the user's strongest attribute preference      |
| Trending for you     | ≥4 products with ≥3 engagement events in 14 days           |
| Recently viewed      | ≥2 viewed products                                         |

Sections below their threshold are omitted entirely. An empty or near-empty rail
is worse than no rail.

"Good deals" requires well-evidenced scores: a high score derived from thin
history must not appear under a heading that asserts it is a good deal.

"Trending" is a genuine aggregate over recorded events, not a placeholder. If
there is not enough activity, the section does not appear.

"Recently viewed" keeps the user's own chronological order rather than Bloom's
ranking — it is their history, not a recommendation.

## Explanations

Generated from computed facts only:

```
Matches 3 of your preferences: olive, boxy, minimal
28% below its original price of 125
Compared across 3 merchants
```

A deal reason is only added when `score >= 75 && !limitedEvidence`.

The product page goes further: `PreferenceMatchPanel` lists which preferences
matched _and which did not_, and exposes the full weighted component breakdown.
A recommendation you cannot interrogate is one you cannot correct.

## What this deliberately is not

No collaborative filtering, no embeddings, no learned model. Those need
engagement data that does not exist yet, and they would make the system
unexplainable at precisely the stage where understanding _why_ it recommends
things is the most valuable thing about it.

The components are independent functions, so replacing any one of them — or
adding a seventh — does not disturb the rest.
