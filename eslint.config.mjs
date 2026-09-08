import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'pw-browsers/**',
    '.bloom/**',
  ]),

  {
    rules: {
      /*
       * A leading underscore marks a parameter that exists to satisfy a
       * signature but is deliberately unused — for example the arguments to
       * `getAffiliateUrl` in a provider whose merchant has no affiliate
       * programme. Renaming is the conventional way to say "intentionally
       * ignored"; without this the only alternative is a disable comment at
       * every occurrence.
       */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
])

export default eslintConfig
