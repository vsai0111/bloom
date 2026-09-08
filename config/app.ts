/** Static application metadata and navigation. */

export const APP_NAME = 'Bloom'
export const APP_TAGLINE = 'Shop what suits you, when it is worth buying'
export const APP_DESCRIPTION =
  'Bloom learns what you like and tells you when it is genuinely a good time to buy.'

/** Primary authenticated navigation. */
export const PRIMARY_NAV = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/search', label: 'Search', icon: 'search' },
  { href: '/saved', label: 'Saved', icon: 'bookmark' },
  { href: '/preferences', label: 'Preferences', icon: 'sliders' },
  { href: '/profile', label: 'Profile', icon: 'user' },
] as const

export const DEFAULT_CURRENCY = 'USD'
export const DEFAULT_LOCALE = 'en-US'

/** Page sizes used across the app. */
export const PAGE_SIZE = {
  search: 24,
  feed: 24,
  saved: 48,
} as const

/** Recently-viewed history retained per user. */
export const RECENTLY_VIEWED_LIMIT = 12
