import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Tests run in plain Node, where the real `server-only` package throws on
      // import. The guard still applies to the Next.js build, which is where it
      // actually protects anything.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests each build an isolated PostgreSQL; give them room.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    /*
     * One test file at a time.
     *
     * Each integration file starts its own PGlite instance, and PGlite carries a
     * substantial WASM heap. Running files in parallel forks puts several of
     * those in memory at once, which exhausts the V8 zone allocator and kills
     * the worker outright. Sequential files keep exactly one database alive at a
     * time; the whole suite still finishes in under a minute.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'services/**/*.ts'],
      exclude: ['**/*.d.ts', 'lib/**/index.ts'],
    },
  },
})
