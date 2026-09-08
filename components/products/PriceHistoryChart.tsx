import type { PricePoint } from '@/types/catalog'
import { formatDate, formatMoney } from '@/lib/utils/format'

/**
 * Price history sparkline.
 *
 * Inline SVG rather than a charting library: it is one polyline, it renders on
 * the server with no client JavaScript, and it adds nothing to the bundle.
 *
 * Accessibility: the chart itself is decorative to assistive technology, and a
 * real data table carries the same information. A screen-reader user gets the
 * numbers rather than "graphic".
 */
export function PriceHistoryChart({
  points,
  currency,
}: {
  points: readonly PricePoint[]
  currency: string
}) {
  if (points.length < 2) {
    return (
      <p className="text-ink-subtle text-sm">
        Not enough recorded prices yet to draw a history for this listing.
      </p>
    )
  }

  const width = 640
  const height = 160
  const padding = { top: 12, right: 8, bottom: 20, left: 8 }

  const prices = points.map((point) => point.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  // A completely flat series would divide by zero; give it a nominal range so
  // the line renders through the middle instead of vanishing.
  const range = max - min || Math.max(max * 0.1, 1)

  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const coordinates = points.map((point, index) => {
    const x = padding.left + (index / (points.length - 1)) * innerWidth
    const y = padding.top + innerHeight - ((point.price - min) / range) * innerHeight
    return { x, y, point }
  })

  const line = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${padding.left},${padding.top + innerHeight} ${line} ${(padding.left + innerWidth).toFixed(1)},${padding.top + innerHeight}`

  const latest = coordinates[coordinates.length - 1]
  const lowest = coordinates.reduce((best, current) =>
    current.point.price < best.point.price ? current : best,
  )

  const first = points[0]
  const last = points[points.length - 1]

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <polygon points={area} className="fill-accent/10" />
        <polyline
          points={line}
          fill="none"
          className="stroke-accent"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={lowest.x} cy={lowest.y} r="3.5" className="fill-positive" />
        <circle cx={latest.x} cy={latest.y} r="4" className="fill-accent-strong" />
      </svg>

      <figcaption className="text-ink-subtle mt-2 flex justify-between text-xs">
        <span>{formatDate(first.recordedAt)}</span>
        <span>
          Low {formatMoney(min, currency)} · High {formatMoney(max, currency)}
        </span>
        <span>{formatDate(last.recordedAt)}</span>
      </figcaption>

      {/* The same data, readable. Collapsed by default so it does not dominate. */}
      <details className="mt-3">
        <summary className="text-ink-muted cursor-pointer text-xs underline underline-offset-2">
          View price history as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Recorded prices for this listing, oldest first</caption>
            <thead className="bg-surface sticky top-0">
              <tr className="text-ink-subtle">
                <th scope="col" className="py-1 pr-4 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1 font-medium">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={`${point.recordedAt}-${point.price}`} className="border-line border-t">
                  <td className="text-ink-muted py-1 pr-4">{formatDate(point.recordedAt)}</td>
                  <td className="text-ink py-1">{formatMoney(point.price, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
