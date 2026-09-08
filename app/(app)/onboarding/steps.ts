/**
 * Onboarding step definitions.
 *
 * Kept out of actions.ts because a `'use server'` module may only export async
 * functions — exporting this array from there is a build error.
 */
export const ONBOARDING_STEPS = ['categories', 'colors', 'style', 'budget'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]
