import { expect, test, type Page } from '@playwright/test'

/**
 * The core Bloom journey, end to end.
 *
 * This is the definition-of-done path from the product brief:
 *
 *   sign up -> onboarding -> personalised home -> search -> product page
 *           -> save -> merchant click
 *
 * If this breaks, the product does not work, regardless of what the unit tests
 * say. It runs against a real server with a real seeded database.
 */

/** Unique per run so repeated runs do not collide on the email unique index. */
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}@bloom.test`
}

const PASSWORD = 'correct-horse-battery-staple'

async function signUp(page: Page): Promise<string> {
  const email = uniqueEmail()

  await page.goto('/signup')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/onboarding/)
  return email
}

test.describe('core journey', () => {
  test('sign up, onboard, discover, save and click through to a merchant', async ({ page }) => {
    // --- Landing ------------------------------------------------------------
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // --- Sign up ------------------------------------------------------------
    await signUp(page)

    // --- Onboarding: choose categories, then walk the remaining steps -------
    await expect(page.getByRole('heading', { name: /what are you shopping for/i })).toBeVisible()
    await page.getByText('Clothing', { exact: true }).click()
    await page.getByText('Shoes', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Colours
    await expect(page.getByRole('heading', { name: /colours/i })).toBeVisible()
    await page.getByText('Olive', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Style
    await page.getByText('Minimal', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Budget is the final step
    await page.getByRole('button', { name: /finish/i }).click()

    await expect(page).toHaveURL(/\/onboarding\/complete/)
    await page.getByRole('button', { name: /show me my feed/i }).click()

    // --- Personalised home --------------------------------------------------
    await expect(page).toHaveURL(/\/home/)
    await expect(page.getByRole('heading', { name: /hello/i })).toBeVisible()

    const forYou = page.getByRole('heading', { name: 'For you' })
    await expect(forYou).toBeVisible()

    // The feed must actually contain products.
    const firstCard = page.getByRole('article').first()
    await expect(firstCard).toBeVisible()

    // --- Search -------------------------------------------------------------
    await page.getByRole('link', { name: 'Search' }).first().click()
    await expect(page).toHaveURL(/\/search/)

    await page.getByRole('searchbox', { name: /search products/i }).fill('linen')
    await page.getByRole('button', { name: 'Search', exact: true }).click()

    await expect(page).toHaveURL(/q=linen/)
    await expect(page.getByRole('status')).toContainText(/product/i)

    // --- Product page -------------------------------------------------------
    await page.getByRole('article').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/product\//)

    // Deal intelligence and the personalisation explanation are the product's
    // reason for existing; both must render.
    await expect(page.getByRole('heading', { name: 'Price intelligence' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /why this is in your feed/i })).toBeVisible()

    // --- Save ---------------------------------------------------------------
    const saveButton = page.getByRole('button', { name: /^Save / }).first()
    await saveButton.click()
    await expect(page.getByRole('button', { name: /^Remove .* from saved/ }).first()).toBeVisible()

    const productUrl = page.url()

    // --- Saved page ---------------------------------------------------------
    await page.getByRole('link', { name: 'Saved' }).first().click()
    await expect(page).toHaveURL(/\/saved/)
    await expect(page.getByRole('article').first()).toBeVisible()

    // --- Merchant click-out -------------------------------------------------
    await page.goto(productUrl)
    const buyLink = page.getByRole('link', { name: /^Buy at / })
    await expect(buyLink).toBeVisible()

    const href = await buyLink.getAttribute('href')
    expect(href).toMatch(/^\/go\/[0-9a-f-]{36}$/)

    // Follow the redirect without leaving the site: the merchant domains are
    // fictional (.example) and deliberately unreachable, so assert on the 302
    // and its Location header rather than on a navigation.
    const response = await page.request.get(href!, { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers()['location']).toMatch(/^https?:\/\//)
  })

  test('rejects an unknown listing id instead of redirecting anywhere', async ({ page }) => {
    await signUp(page)

    // A well-formed but non-existent id must not redirect off-site.
    const response = await page.request.get('/go/00000000-0000-0000-0000-000000000000', {
      maxRedirects: 0,
    })
    expect(response.status()).toBe(302)
    expect(response.headers()['location']).toContain('/home?error=')
  })

  test('preferences are visible and removable', async ({ page }) => {
    await signUp(page)

    await page.goto('/onboarding?step=categories')
    await page.getByText('Clothing', { exact: true }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.goto('/preferences')
    await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()

    // The audit table must list what Bloom believes, with a way to remove it.
    const table = page.getByRole('table', { name: /your preferences/i })
    await expect(table).toBeVisible()
    await expect(table.getByRole('button', { name: /^Remove/ }).first()).toBeVisible()
  })

  test('signed-out visitors cannot reach the feed', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/home')
    await expect(page).toHaveURL(/\/signin/)
  })
})
