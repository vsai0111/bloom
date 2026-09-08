import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COLORS,
  FITS,
  PRICE_BANDS,
  STYLES,
  type Category,
} from '@/config/taxonomy'
import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { Button } from '@/components/ui/Button'
import { humanize } from '@/lib/utils/format'
import { saveOnboardingStepAction, skipOnboardingAction } from './actions'
import { ONBOARDING_STEPS, type OnboardingStep } from './steps'

export const metadata = { title: 'Set up your feed' }

interface StepDefinition {
  title: string
  subtitle: string
  options: Array<{ value: string; label: string }>
  multiple: boolean
}

const STEP_DEFINITIONS: Record<OnboardingStep, StepDefinition> = {
  categories: {
    title: 'What are you shopping for?',
    subtitle: 'Pick as many as you like. This is the biggest single thing that shapes your feed.',
    options: CATEGORIES.map((category) => ({
      value: category,
      label: CATEGORY_LABELS[category as Category],
    })),
    multiple: true,
  },
  colors: {
    title: 'Any colours you gravitate towards?',
    subtitle: 'Optional — it helps us rank, and you can change it any time.',
    options: COLORS.filter((color) => color !== 'multi').map((color) => ({
      value: color,
      label: humanize(color),
    })),
    multiple: true,
  },
  style: {
    title: 'How would you describe what you wear?',
    subtitle: 'Pick the words that fit. Skip if none of them do.',
    options: [...STYLES, ...FITS].map((value) => ({ value, label: humanize(value) })),
    multiple: true,
  },
  budget: {
    title: 'Roughly what do you usually spend?',
    subtitle: 'A range is enough. We use it to rank, never to hide things from you.',
    options: PRICE_BANDS.map((band) => ({ value: band.id, label: `$${band.label}` })),
    multiple: true,
  },
}

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export default async function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  const session = await requireUser('/onboarding')
  const params = await searchParams

  const step: OnboardingStep = isStep(params.step) ? params.step : 'categories'
  const index = ONBOARDING_STEPS.indexOf(step)
  const definition = STEP_DEFINITIONS[step]
  const following = ONBOARDING_STEPS[index + 1]
  const nextHref = following ? `/onboarding?step=${following}` : '/onboarding/complete'

  // Someone who has already finished has no reason to be here.
  if (session.profile.onboardingCompleted && !params.step) redirect('/home')

  if (index === 0) {
    const db = await getDb()
    await recordEvent(db, { userId: session.id, eventType: 'onboarding_started' })
  }

  return (
    <div className="mx-auto max-w-2xl py-4">
      <p className="text-ink-subtle text-sm">
        Step {index + 1} of {ONBOARDING_STEPS.length}
      </p>

      {/* Native progress element: exposes value and max to assistive tech for free. */}
      <progress
        className="[&::-webkit-progress-bar]:bg-surface-sunken [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent mt-2 h-1 w-full overflow-hidden rounded-full"
        value={index + 1}
        max={ONBOARDING_STEPS.length}
      >
        {index + 1} of {ONBOARDING_STEPS.length}
      </progress>

      <h1 className="text-ink mt-6 text-2xl font-semibold tracking-tight">{definition.title}</h1>
      <p className="text-ink-muted mt-2 text-sm">{definition.subtitle}</p>

      <form action={saveOnboardingStepAction} className="mt-7">
        <input type="hidden" name="step" value={step} />

        <fieldset>
          <legend className="sr-only">{definition.title}</legend>
          <div className="flex flex-wrap gap-2">
            {definition.options.map((option) => (
              <label
                key={option.value}
                className="border-line-strong bg-surface text-ink hover:bg-surface-sunken has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent-strong has-focus-visible:outline-accent cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors has-focus-visible:outline has-focus-visible:outline-2"
              >
                <input type="checkbox" name="value" value={option.value} className="sr-only" />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-8 flex items-center gap-3">
          <Button type="submit" size="lg">
            {index === ONBOARDING_STEPS.length - 1 ? 'Finish' : 'Continue'}
          </Button>

          {/* A link, not a submit button: a submit would save whatever boxes
              happened to be ticked, which is the opposite of skipping. */}
          <Link
            href={nextHref}
            className="text-ink-muted hover:text-ink inline-flex h-12 items-center px-4 text-sm font-medium underline underline-offset-2"
          >
            Skip this
          </Link>
        </div>
      </form>

      <form action={skipOnboardingAction} className="border-line mt-6 border-t pt-5">
        <button
          type="submit"
          className="text-ink-subtle hover:text-ink text-sm underline underline-offset-2"
        >
          Skip the whole setup and go to my feed
        </button>
      </form>
    </div>
  )
}
