'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSessionUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { getSessionId } from '@/lib/analytics/session'
import { rejectProduct, toggleLike, toggleSave, undoRejection } from '@/lib/engagement/repository'
import { removePreference, upsertPreference } from '@/lib/preferences/repository'
import { logger, reportError } from '@/lib/logging/logger'

/**
 * Server Actions for user signals.
 *
 * Security notes that apply to every action here:
 *
 *  - The user id is ALWAYS taken from the verified session, never from an
 *    argument. A client can ask to save product X; it can never say who is
 *    saving it.
 *  - Every argument is validated with zod before it reaches SQL.
 *  - Next.js verifies the Origin header on Server Action POSTs, which together
 *    with the SameSite=Lax session cookie is the CSRF control.
 *  - Failures return a typed result rather than throwing, so the UI can show
 *    something useful instead of an error boundary.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; reference?: string }

const uuid = z.string().uuid()

const rejectionReason = z.enum([
  'not_my_style',
  'too_expensive',
  'wrong_size',
  'already_own',
  'disliked_brand',
  'other',
])

/** Shared wrapper: authenticate, run, translate failures into a result. */
async function withUser<T>(
  operation: string,
  fn: (userId: string) => Promise<T>,
): Promise<ActionResult<T>> {
  const session = await getSessionUser()
  if (!session) {
    return { ok: false, error: 'You need to be signed in to do that.' }
  }

  try {
    const data = await fn(session.id)
    return { ok: true, data } as ActionResult<T>
  } catch (error) {
    const reference = reportError(error, { operation, userId: session.id })
    return {
      ok: false,
      error: 'Something went wrong. Please try again.',
      reference,
    }
  }
}

export async function toggleSaveAction(
  productId: string,
): Promise<ActionResult<{ saved: boolean }>> {
  const parsed = uuid.safeParse(productId)
  if (!parsed.success) return { ok: false, error: 'That product could not be found.' }

  return withUser('toggleSave', async (userId) => {
    const db = await getDb()
    const result = await toggleSave(db, userId, parsed.data)

    await recordEvent(db, {
      userId,
      sessionId: await getSessionId(),
      eventType: result.saved ? 'product_saved' : 'product_unsaved',
      productId: parsed.data,
    })

    revalidatePath('/saved')
    revalidatePath('/home')
    return result
  })
}

export async function toggleLikeAction(
  productId: string,
): Promise<ActionResult<{ liked: boolean }>> {
  const parsed = uuid.safeParse(productId)
  if (!parsed.success) return { ok: false, error: 'That product could not be found.' }

  return withUser('toggleLike', async (userId) => {
    const db = await getDb()
    const result = await toggleLike(db, userId, parsed.data)

    await recordEvent(db, {
      userId,
      sessionId: await getSessionId(),
      eventType: result.liked ? 'product_liked' : 'product_unliked',
      productId: parsed.data,
    })

    revalidatePath('/home')
    return result
  })
}

export async function rejectProductAction(
  productId: string,
  reason?: string,
): Promise<ActionResult> {
  const parsedId = uuid.safeParse(productId)
  if (!parsedId.success) return { ok: false, error: 'That product could not be found.' }

  const parsedReason = reason ? rejectionReason.safeParse(reason) : null

  return withUser('rejectProduct', async (userId) => {
    const db = await getDb()
    await rejectProduct(
      db,
      userId,
      parsedId.data,
      parsedReason?.success ? parsedReason.data : undefined,
    )

    await recordEvent(db, {
      userId,
      sessionId: await getSessionId(),
      eventType: 'product_rejected',
      productId: parsedId.data,
      metadata: { reason: parsedReason?.success ? parsedReason.data : 'unspecified' },
    })

    revalidatePath('/home')
    revalidatePath('/saved')
    return undefined
  }) as Promise<ActionResult>
}

export async function undoRejectionAction(productId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(productId)
  if (!parsed.success) return { ok: false, error: 'That product could not be found.' }

  return withUser('undoRejection', async (userId) => {
    const db = await getDb()
    await undoRejection(db, userId, parsed.data)
    revalidatePath('/home')
    return undefined
  }) as Promise<ActionResult>
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const preferenceInput = z.object({
  attribute: z.string().min(1).max(40),
  value: z.string().min(1).max(80),
  category: z.string().max(40).nullish(),
  weight: z.number().min(0).max(1).optional(),
})

export async function addPreferenceAction(input: unknown): Promise<ActionResult> {
  const parsed = preferenceInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That preference is not valid.' }

  return withUser('addPreference', async (userId) => {
    const db = await getDb()
    const preference = await upsertPreference(db, userId, {
      attribute: parsed.data.attribute,
      value: parsed.data.value,
      category: parsed.data.category ?? null,
      weight: parsed.data.weight,
      source: 'explicit',
    })

    if (!preference) {
      logger.warn('preference rejected by repository', { attribute: parsed.data.attribute })
      return undefined
    }

    await recordEvent(db, {
      userId,
      eventType: 'preference_added',
      metadata: { attribute: preference.attribute, value: preference.value },
    })

    revalidatePath('/preferences')
    revalidatePath('/home')
    return undefined
  }) as Promise<ActionResult>
}

export async function removePreferenceAction(preferenceId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(preferenceId)
  if (!parsed.success) return { ok: false, error: 'That preference could not be found.' }

  return withUser('removePreference', async (userId) => {
    const db = await getDb()
    // Scoped by user inside the repository, so one user cannot delete another's.
    const removed = await removePreference(db, userId, parsed.data)

    if (removed) {
      await recordEvent(db, {
        userId,
        eventType: 'preference_removed',
        metadata: { preferenceId: parsed.data },
      })
    }

    revalidatePath('/preferences')
    revalidatePath('/home')
    return undefined
  }) as Promise<ActionResult>
}
