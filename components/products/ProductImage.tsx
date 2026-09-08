import Image from 'next/image'
import { cn } from '@/lib/utils/cn'

/**
 * Product imagery.
 *
 * Seeded listings point at /api/product-image/* (generated SVG) which the Next
 * image optimizer neither can nor should process, so those bypass it. Real
 * merchant images — remote raster files — go through the optimizer for
 * resizing and modern formats.
 *
 * `alt` is required by the type, not optional with a default: a product image
 * with no description is unusable to a screen reader, and making it required
 * means that cannot be forgotten.
 */
export function ProductImage({
  src,
  alt,
  className,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  priority = false,
}: {
  src: string | null
  alt: string
  className?: string
  sizes?: string
  priority?: boolean
}) {
  if (!src) {
    return (
      <div
        className={cn('bg-surface-sunken flex items-center justify-center', className)}
        role="img"
        aria-label={`No image available for ${alt}`}
      >
        <span aria-hidden="true" className="text-ink-subtle text-2xl">
          ◍
        </span>
      </div>
    )
  }

  const isGenerated = src.startsWith('/api/product-image/')

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={isGenerated}
      className={cn('object-cover', className)}
    />
  )
}
