import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by webpack/turbopack.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],

  /*
   * Files read from disk at runtime rather than imported.
   *
   * `lib/db/migrate.ts` discovers migrations with `readdir(cwd/supabase/
   * migrations)`, and PGlite loads its PostgreSQL image from `.wasm`/`.data`
   * files beside its entry point. Neither is a static import, so the build's
   * dependency tracing cannot see them and would omit them from the serverless
   * bundle — leaving the embedded driver to fail on a missing file the moment
   * it got past creating its data directory.
   */
  outputFileTracingIncludes: {
    '/**/*': ['./supabase/migrations/**/*.sql', './node_modules/@electric-sql/pglite/dist/**'],
  },

  images: {
    // Merchant image hosts are added here as real merchants are onboarded.
    // Seeded catalogue images are local SVGs under /public and bypass the
    // optimizer (see components/products/ProductImage.tsx).
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
