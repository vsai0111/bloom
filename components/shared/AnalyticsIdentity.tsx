'use client'

import { useEffect } from 'react'
import { identify } from '@/lib/analytics/client'

/**
 * Associate browser-side analytics with the signed-in user.
 *
 * A no-op when no analytics provider is configured — which is the current
 * state, since no PostHog credentials have been provisioned.
 */
export function AnalyticsIdentity({ userId }: { userId: string }) {
  useEffect(() => {
    void identify(userId)
  }, [userId])

  return null
}
