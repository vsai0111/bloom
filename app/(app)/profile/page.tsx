import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { countSaved } from '@/lib/engagement/repository'
import { countPreferences } from '@/lib/preferences/repository'
import { signOutAction } from '@/app/(auth)/actions'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/format'
import { num } from '@/lib/db/rows'

export const metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const session = await requireUser('/profile')
  const db = await getDb()

  const [saved, preferences, activity] = await Promise.all([
    countSaved(db, session.id),
    countPreferences(db, session.id),
    db.query<{ views: number; likes: number; clicks: number }>(
      `select
         count(*) filter (where event_type = 'product_viewed')::int   as views,
         count(*) filter (where event_type = 'product_liked')::int    as likes,
         count(*) filter (where event_type = 'merchant_clicked')::int as clicks
       from user_events where user_id = $1`,
      [session.id],
    ),
  ])

  const stats = [
    { label: 'Preferences', value: preferences, href: '/preferences' },
    { label: 'Saved', value: saved, href: '/saved' },
    { label: 'Products viewed', value: num(activity[0]?.views) },
    { label: 'Liked', value: num(activity[0]?.likes) },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      <header>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          {session.profile.displayName}
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Member since {formatDate(session.profile.createdAt)}
        </p>
      </header>

      <Card className="p-5">
        <h2 className="text-ink text-sm font-medium">Your activity</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-ink-subtle text-xs">{stat.label}</dt>
              <dd className="text-ink text-xl font-semibold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="text-ink text-sm font-medium">How Bloom uses your data</h2>
        <p className="text-ink-muted mt-2 text-sm leading-relaxed">
          Bloom records what you view, save, like and dismiss, and uses it to rank products for you.
          That activity stays in Bloom&apos;s own database. Your preferences are visible and
          editable — nothing is inferred that you cannot see and remove.
        </p>
        <ButtonLink href="/preferences" variant="secondary" size="sm" className="mt-4">
          Review your preferences
        </ButtonLink>
      </Card>

      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  )
}
