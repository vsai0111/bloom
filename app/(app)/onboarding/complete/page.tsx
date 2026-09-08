import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { countPreferences } from '@/lib/preferences/repository'
import { Button } from '@/components/ui/Button'
import { completeOnboardingAction } from '../actions'

export const metadata = { title: 'You are set up' }

export default async function OnboardingCompletePage() {
  const session = await requireUser('/onboarding/complete')
  const db = await getDb()
  const count = await countPreferences(db, session.id)

  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">That is enough to start</h1>

      <p className="text-ink-muted mt-3 text-sm leading-relaxed">
        {count === 0
          ? 'You skipped the questions, which is fine — your feed will start broad and sharpen as you save, like and dismiss things.'
          : `We have ${count} preference${count === 1 ? '' : 's'} to work with. Your feed will keep improving as you save, like and dismiss things.`}
      </p>

      <form action={completeOnboardingAction} className="mt-8">
        <Button type="submit" size="lg">
          Show me my feed
        </Button>
      </form>
    </div>
  )
}
