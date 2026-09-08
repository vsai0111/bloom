'use client'

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Labelled form controls.
 *
 * The label is always rendered and always associated with its control via a
 * generated id — placeholder-as-label is inaccessible and disappears the moment
 * someone starts typing. Errors are wired with aria-describedby and
 * aria-invalid so they are announced rather than merely coloured red.
 */

const CONTROL =
  'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2.5 ' +
  'text-ink placeholder:text-ink-subtle disabled:opacity-60 aria-[invalid=true]:border-negative'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  error?: string
  hint?: ReactNode
}

export function Field({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {label}
      </label>

      <input
        id={id}
        className={cn(CONTROL, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, hint && hintId) || undefined}
        {...props}
      />

      {hint && (
        <p id={hintId} className="text-ink-subtle text-xs">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="text-negative text-xs">
          {error}
        </p>
      )}
    </div>
  )
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  /** Hide the label visually but keep it for assistive technology. */
  labelHidden?: boolean
  children: ReactNode
}

export function SelectField({
  label,
  labelHidden = false,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const id = useId()

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className={cn('text-ink block text-sm font-medium', labelHidden && 'sr-only')}
      >
        {label}
      </label>
      <select id={id} className={cn(CONTROL, 'pr-8', className)} {...props}>
        {children}
      </select>
    </div>
  )
}
