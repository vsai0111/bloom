import { ButtonLink } from '@/components/ui/Button'

export const metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-ink text-xl font-semibold">We could not find that</h1>
      <p className="text-ink-muted mt-2 text-sm">
        The page or product you were looking for does not exist, or is no longer stocked.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <ButtonLink href="/home">Back to your feed</ButtonLink>
        <ButtonLink href="/search" variant="secondary">
          Search products
        </ButtonLink>
      </div>
    </div>
  )
}
