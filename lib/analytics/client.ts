'use client'

import { posthogEnabled, publicEnv } from '@/config/env.public'
import type { EventType } from '@/types/user'

/**
 * Browser-side analytics.
 *
 * A thin abstraction over whatever product-analytics tool is configured, so no
 * component ever imports a vendor SDK directly. When nothing is configured
 * (the default — no credentials have been provisioned) every call is a no-op
 * and absolutely no network request is made.
 *
 * Server-side events still go to `user_events` regardless; this is only the
 * exploratory mirror. See lib/analytics/events.ts.
 */

type Properties = Record<string, string | number | boolean | null | undefined>

let loaded: Promise<typeof import('posthog-js').default | null> | null = null

/** Load PostHog lazily, so it never enters the initial bundle when unused. */
async function client() {
  if (!posthogEnabled) return null

  loaded ??= import('posthog-js')
    .then((module) => {
      const posthog = module.default
      posthog.init(publicEnv.posthogKey, {
        api_host: publicEnv.posthogHost,
        capture_pageview: false,
        // Bloom sends its own events; autocapture would record clicks on
        // everything, including values we deliberately keep out of analytics.
        autocapture: false,
        persistence: 'localStorage+cookie',
      })
      return posthog
    })
    .catch(() => null)

  return loaded
}

export async function track(event: EventType | string, properties: Properties = {}): Promise<void> {
  const posthog = await client()
  posthog?.capture(event, properties)
}

export async function identify(userId: string): Promise<void> {
  const posthog = await client()
  posthog?.identify(userId)
}

export async function resetAnalyticsIdentity(): Promise<void> {
  const posthog = await client()
  posthog?.reset()
}
