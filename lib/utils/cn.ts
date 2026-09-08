import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, resolving Tailwind conflicts.
 *
 * `twMerge` makes the last conflicting utility win, so a component's default
 * (`px-4`) can be overridden by a caller's `px-6` without both ending up in the
 * class list and the outcome depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
