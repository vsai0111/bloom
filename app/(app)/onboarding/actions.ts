'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { CATEGORIES, COLORS, FITS, PRICE_BANDS, STYLES } from '@/config/taxonomy'
import { getSessionUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { upsertPreference } from '@/lib/preferences/repository'
import { reportError } from '@/lib/logging/logger'
import { ONBOARDING_STEPS, type OnboardingStep } from './steps'

/**
 * Onboarding.
 *
 * Four short steps, every one skippable. The goal is the smallest number of
 * answers that produce a feed worth looking at — not a complete taste profile.
 * Everything else is learned from behaviour once the user is actually using the
 * product.
 *
 * Each step is a plain form POST, so the flow works without client JavaScript.
 */

/** Which vocabulary each step is allowed to write, and under which attribute. */
const STEP_CONFIG: Record<
  OnboardingStep,
  { attribute: string; allowed: readonly string[]; weight: number }
> = {
  categories: { attribute: 'category', allowed: CATEGORIES, weight: 0.9 },
  colors: { attribute: 'color', allowed: COLORS, weight: 0.75 },
  style: { attribute: 'style', allowed: [...STYLES, ...FITS], weight: 0.7 },
  budget: { attribute: 'price_band', allowed: PRICE_BANDS.map((b) => b.id), weight: 0.8 },
}

function nextStep(current: OnboardingStep): string {
  const index = ONBOARDING_STEPS.indexOf(current)
  const next = ONBOARDING_STEPS[index + 1]
  return next ? `/onboarding?step=${next}` : '/onboarding/complete'
}

const stepSchema = z.enum(ONBOARDING_STEPS)

export async function saveOnboardingStepAction(formData: FormData): Promise<void> {
  const session = await getSessionUser()
  if (!session) redirect('/signin')

  const parsedStep = stepSchema.safeParse(String(formData.get('step') ?? ''))
  if (!parsedStep.success) redirect('/onboarding')

  const step = parsedStep.data
  const config = STEP_CONFIG[step]

  try {
    const db = await getDb()

    // Only values from this step's own vocabulary are accepted; anything else
    // in the POST body is discarded rather than trusted.
    const values = formData
      .getAll('value')
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => config.allowed.includes(value))
      .slice(0, 12)

    for (const value of values) {
      // `style` covers both aesthetic styles and fits; route each to the right
      // attribute so scoring compares like with like.
      const attribute =
        step === 'style' && (FITS as readonly string[]).includes(value) ? 'fit' : config.attribute

      await upsertPreference(db, session.id, {
        attribute,
        value,
        weight: config.weight,
        source: 'explicit',
      })
    }

    if (values.length > 0) {
      await recordEvent(db, {
        userId: session.id,
        eventType: 'preference_added',
        metadata: { step, count: values.length, values },
      })
    }
  } catch (error) {
    reportError(error, { operation: 'onboardingStep', step })
    // Never trap the user in onboarding because a write failed — they can set
    // preferences later from the preferences page.
  }

  redirect(nextStep(step))
}

export async function completeOnboardingAction(): Promise<void> {
  const session = await getSessionUser()
  if (!session) redirect('/signin')

  try {
    const db = await getDb()
    await db.query(`update profiles set onboarding_completed = true where id = $1`, [session.id])
    await recordEvent(db, { userId: session.id, eventType: 'onboarding_completed' })
  } catch (error) {
    reportError(error, { operation: 'completeOnboarding' })
  }

  redirect('/home')
}

export async function skipOnboardingAction(): Promise<void> {
  await completeOnboardingAction()
}
