import { expect, test } from '@playwright/test'

// End-to-end smoke over the critical path: log in with the seeded demo account,
// run a natural-language query (demo SQLite + rule-based fallback, no AI key
// needed), and reach the dashboards page. Runs against the built app in CI.
test('login → query → dashboards', async ({ page }) => {
  // --- Login ---
  await page.goto('/login')
  await page.fill('input[name="email"]', 'demo@nexusbi.io')
  await page.fill('input[name="password"]', 'demo1234')
  await page.press('input[name="password"]', 'Enter') // submits the form
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })

  // --- Run a query ---
  const input = page.getByPlaceholder(/sual/)
  await expect(input).toBeVisible()
  await input.fill('Ən çox satan 5 məhsul hansıdır?')
  await input.press('Enter')
  // Result card shows a "{n} sətir · {ms} ms" meta line once the query resolves.
  await expect(page.getByText(/sətir ·/).first()).toBeVisible({ timeout: 20_000 })

  // --- Export the chart as a PNG ---
  // The only end-to-end cover for the rasterization path: it runs against the
  // built preview, so the production CSP is live here. That matters because the
  // serialized chart is handed to an <img> as a data: URL — img-src allows data:
  // and deliberately not blob:, so a "modernized" object-URL would fail HERE and
  // nowhere else.
  await page.getByRole('button', { name: 'Sütun' }).click() // force an SVG chart type
  await page.getByRole('button', { name: 'Yüklə' }).click()
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /PNG/ }).click()
  expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/)

  // --- Dashboards ---
  await page.goto('/dashboards')
  await expect(page.getByRole('heading', { name: 'Dashboard-lar' })).toBeVisible()
})
