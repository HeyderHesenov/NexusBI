import { expect, test } from '@playwright/test'
import type { Readable } from 'node:stream'

/** Collect a download stream into one Buffer. */
async function readAll(stream: Readable | null): Promise<Buffer> {
  if (!stream) throw new Error('download had no readable stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

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
  // Line charts sit inside ChartZoom, whose zoom buttons render lucide <svg>
  // icons BEFORE the chart in DOM order — so picking the wrong <svg> yields a
  // valid 14px PNG of a magnifier and a passing filename assertion. Hence the
  // size check below: it is the only thing that distinguishes chart from icon.
  await page.getByRole('button', { name: 'Xətt' }).click()
  await page.getByRole('button', { name: 'Yüklə' }).click()
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /PNG/ }).click()
  const png = await pngDownload
  expect(png.suggestedFilename()).toMatch(/\.png$/)

  const bytes = await readAll(await png.createReadStream())
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  // IHDR width/height are big-endian uint32 at offsets 16 and 20.
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  expect(width).toBeGreaterThan(400)
  // Exactly the inline chart's 320px at the 2× raster scale. Pinned rather than
  // bounded so the check cannot pass on a zoom icon (28px) OR on chartExport's
  // 800×400 "never measured" fallback — both of which would otherwise look fine.
  expect(height).toBe(640)

  // --- Dashboards ---
  await page.goto('/dashboards')
  await expect(page.getByRole('heading', { name: 'Dashboard-lar' })).toBeVisible()
})
