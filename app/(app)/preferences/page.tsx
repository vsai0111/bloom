import {
  CATEGORIES,
  CATEGORY_LABELS,
  COLORS,
  FITS,
  MATERIALS,
  PRICE_BANDS,
  STYLES,
  type Category,
} from '@/config/taxonomy'
import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { listPreferences } from '@/lib/preferences/repository'
import { listBrands } from '@/lib/products/repository'
import { humanize } from '@/lib/utils/format'
import { PreferenceEditor } from '@/components/preferences/PreferenceEditor'
import { LearnedPreferences } from '@/components/preferences/LearnedPreferences'

export const metadata = { title: 'Preferences' }

/**
 * Preferences.
 *
 * Two halves: the controlled vocabulary a user can pick from, and a full list
 * of everything Bloom currently believes — including behaviourally-learned
 * preferences with their weights. Nothing is hidden from the user.
 */
export default async function PreferencesPage() {
  const session = await requireUser('/preferences')
  const db = await getDb()

  const [preferences, brands] = await Promise.all([
    listPreferences(db, session.id),
    listBrands(db, 24),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <header>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-ink-muted mt-1 text-sm">
          These drive your feed. Add or remove anything — changes take effect immediately, and
          anything Bloom worked out from your activity is marked and can be deleted.
        </p>
      </header>

      <PreferenceEditor
        attribute="category"
        label="What you shop for"
        description="The strongest signal. Products outside these categories are ranked much lower."
        options={CATEGORIES}
        preferences={preferences}
      />

      <PreferenceEditor
        attribute="color"
        label="Colours"
        options={COLORS.filter((color) => color !== 'multi')}
        preferences={preferences}
      />

      <PreferenceEditor
        attribute="style"
        label="Style"
        options={STYLES}
        preferences={preferences}
      />

      <PreferenceEditor attribute="fit" label="Fit" options={FITS} preferences={preferences} />

      <PreferenceEditor
        attribute="material"
        label="Materials"
        options={MATERIALS.slice(0, 12)}
        preferences={preferences}
      />

      <PreferenceEditor
        attribute="price_band"
        label="Typical spend"
        description="Used to rank, never to hide products from you."
        options={PRICE_BANDS.map((band) => band.id)}
        preferences={preferences}
      />

      {brands.length > 0 && (
        <PreferenceEditor
          attribute="brand"
          label="Brands"
          description="Brands you like are boosted. Unfamiliar brands are not penalised, so you can still discover new ones."
          options={brands.map((brand) => brand.toLowerCase())}
          preferences={preferences}
        />
      )}

      <LearnedPreferences preferences={preferences} />

      <section className="border-line bg-surface rounded-[var(--radius-card)] border p-5">
        <h2 className="text-ink text-sm font-semibold">How these are used</h2>
        <ul className="text-ink-muted mt-3 space-y-2 text-sm">
          <li>Preferences you set yourself outrank anything Bloom infers from your behaviour.</li>
          <li>
            A preference is only learned from your activity after the same signal repeats, so one
            curious click does not become a stated taste.
          </li>
          <li>
            Dismissing a product lowers the weight of the attributes it had, and hides it from your
            feed.
          </li>
          <li>
            Categories you have chosen:{' '}
            {preferences.filter((p) => p.attribute === 'category').length === 0
              ? 'none yet — your feed draws from the whole catalogue.'
              : preferences
                  .filter((p) => p.attribute === 'category')
                  .map((p) => CATEGORY_LABELS[p.value as Category] ?? humanize(p.value))
                  .join(', ')}
          </li>
        </ul>
      </section>
    </div>
  )
}
