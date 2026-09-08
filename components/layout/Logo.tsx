import Link from 'next/link'
import { APP_NAME } from '@/config/app'
import { cn } from '@/lib/utils/cn'

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" className="text-accent h-6 w-6" aria-hidden="true" focusable="false">
        <path
          d="M12 21c0-5 3-8 8-8 0 5-3 8-8 8Zm0 0c0-5-3-8-8-8 0 5 3 8 8 8Zm0-2V9m0 0a3.5 3.5 0 1 1 3.5-3.5A3.5 3.5 0 0 1 12 9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-ink text-lg font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  )
}
