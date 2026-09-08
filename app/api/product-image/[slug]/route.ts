import { createRng, hashString } from '@/lib/utils/random'

/**
 * Deterministic placeholder product imagery.
 *
 * The seed catalogue has no photography, and inventing product photos would be
 * dishonest in a different way — a card showing a real-looking garment that
 * does not exist. These are unmistakably abstract: a generated gradient with
 * the brand monogram. Same slug always yields the same image, so the catalogue
 * looks stable rather than reshuffling on every render.
 *
 * When a real merchant feed arrives, listings carry real `image_url`s and this
 * route stops being used. It is not on the path of any real product data.
 */

export const dynamic = 'force-static'

/** Hue pairs chosen to stay legible behind white text in both themes. */
const PALETTE: Array<[number, number]> = [
  [140, 165],
  [200, 225],
  [25, 45],
  [280, 305],
  [95, 120],
  [340, 10],
  [45, 70],
  [255, 280],
]

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params

  // The slug reaches the SVG only after being reduced to a two-character
  // monogram of [A-Z0-9] and XML-escaped, so it cannot inject markup.
  const safeSlug = slug.slice(0, 120)
  const rng = createRng(safeSlug)
  const [hueStart, hueEnd] = PALETTE[hashString(safeSlug) % PALETTE.length]

  const monogram = escapeXml(
    safeSlug
      .split('-')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
      .replace(/[^A-Z0-9]/g, '') || 'B',
  )

  const rotation = Math.round(rng.float(0, 360))
  const blobX = Math.round(rng.float(20, 80))
  const blobY = Math.round(rng.float(20, 80))
  const blobR = Math.round(rng.float(18, 34))

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500" role="img" aria-label="Placeholder product image">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${rotation} 0.5 0.5)">
      <stop offset="0%" stop-color="hsl(${hueStart} 34% 78%)"/>
      <stop offset="100%" stop-color="hsl(${hueEnd} 30% 62%)"/>
    </linearGradient>
  </defs>
  <rect width="400" height="500" fill="url(#g)"/>
  <circle cx="${blobX * 4}" cy="${blobY * 5}" r="${blobR * 3}" fill="hsl(${hueEnd} 40% 88%)" opacity="0.35"/>
  <text x="200" y="250" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif" font-size="96" font-weight="600"
        fill="hsl(${hueEnd} 45% 25%)" opacity="0.55">${monogram}</text>
</svg>`

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Defence in depth: this response is generated markup, so make certain a
      // browser never treats it as an active document.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
