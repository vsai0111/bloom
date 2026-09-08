import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled by webpack/turbopack.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],

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
