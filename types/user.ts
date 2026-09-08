import type { PreferenceSource } from '@/config/scoring'

export interface AuthUser {
  id: string
  email: string
}

export interface Profile {
  id: string
  displayName: string
  onboardingCompleted: boolean
  createdAt: string
}

export interface SessionUser extends AuthUser {
  profile: Profile
}

/**
 * A weighted statement about what a user likes.
 *
 * `category` is nullable: a preference can be global ("I like olive") or scoped
 * to a category ("in clothing I like a boxy fit").
 */
export interface UserPreference {
  id: string
  userId: string
  category: string | null
  attribute: string
  value: string
  weight: number
  source: PreferenceSource
  signalCount: number
  createdAt: string
  updatedAt: string
}

/** A preference as supplied by onboarding or the preferences editor. */
export interface PreferenceInput {
  category?: string | null
  attribute: string
  value: string
  weight?: number
  source?: PreferenceSource
}

export type EventType =
  | 'landing_view'
  | 'signup_started'
  | 'signup_completed'
  | 'signin_completed'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'preference_added'
  | 'preference_removed'
  | 'home_view'
  | 'search_started'
  | 'search_completed'
  | 'product_viewed'
  | 'product_liked'
  | 'product_unliked'
  | 'product_saved'
  | 'product_unsaved'
  | 'product_rejected'
  | 'recommendation_view'
  | 'recommendation_click'
  | 'merchant_clicked'

export interface UserEventInput {
  userId?: string | null
  sessionId?: string | null
  eventType: EventType
  productId?: string | null
  merchantProductId?: string | null
  metadata?: Record<string, unknown>
}
