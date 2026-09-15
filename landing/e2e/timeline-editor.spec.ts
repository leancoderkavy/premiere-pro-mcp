import { test, expect, type Page, type Locator } from "@playwright/test"

const shot = (page: Page, id: number) =>
  page.locator(`.nle-clip:has(.cinema-clip[data-shot="${id}"])`)
const track = (page: Page, id: number) =>
  page.getByRole("group", { name: `Video track ${id + 1}`, exact: true })
async function move(page: Page, handle: Locator, dx: number, targetY?: number, release = true) {
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, targetY ?? box.y + box.height / 2, {
    steps: 15
  })
  if (release) await page.mouse.up()
}
const scale = async (page: Page) => (await page.locator(".nle-canvas").boundingBox())!.width / 720

test.beforeEach(async ({ page }) => {
  await page.goto("/design-preview/")
  await page.locator(".nle-workspace").scrollIntoViewIfNeeded()
})

test("clips move in time and between tracks with one undo step, redo, gaps, and upper-track playback", async ({
  page
}) => {
  const upper = (await track(page, 1).boundingBox())!
  const dx = (await scale(page)) * 48
  await move(page, shot(page, 0).locator(".nle-clip-body"), dx, upper.y + upper.height / 2, false)
  await expect(page.locator(".nle-drag-preview")).toHaveAttribute("data-valid", "true")
  await expect(shot(page, 0)).toHaveAttribute("data-start", "0")
  await page.mouse.up()
  await expect(track(page, 1).locator('.cinema-clip[data-shot="0"]')).toHaveCount(1)
  await expect(shot(page, 0)).toHaveAttribute("data-start", "48")
  const scrub = page.getByRole("slider", { name: "Scrub editing timeline" })
  await scrub.focus()
  await page.keyboard.press("Home")
  await expect(page.locator(".cinema-gap")).toContainText("NO PICTURE")
  // Selecting the lower clip seeks to frame 240. One frame earlier shows the upper clip.
  await shot(page, 1).locator(".nle-clip-body").click()
  await scrub.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.locator(".cinema-caption")).toContainText("Review your selects.")
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  await expect(shot(page, 0)).toHaveAttribute("data-start", "0")
  await expect(track(page, 0).locator('.cinema-clip[data-shot="0"]')).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Redo last edit", exact: true }).click()
  await expect(shot(page, 0)).toHaveAttribute("data-start", "48")
  await expect(track(page, 1).locator('.cinema-clip[data-shot="0"]')).toHaveCount(1)
})

test("direct trim handles preserve neighboring clips and support keyboard precision", async ({
  page
}) => {
  const px = await scale(page)
  await move(
    page,
    page.getByRole("button", { name: "Trim start of clip 01", exact: true }),
    px * 48
  )
  await expect(shot(page, 0)).toHaveAttribute("data-start", "48")
  await expect(shot(page, 0)).toHaveAttribute("data-duration", "144")
  await expect(shot(page, 1)).toHaveAttribute("data-start", "192")
  await move(page, page.getByRole("button", { name: "Trim end of clip 01", exact: true }), -px * 48)
  await expect(shot(page, 0)).toHaveAttribute("data-duration", "96")
  const end = page.getByRole("button", { name: "Trim end of clip 01", exact: true })
  await end.focus()
  await page.keyboard.press("ArrowLeft")
  await expect(shot(page, 0)).toHaveAttribute("data-duration", "95")
  await page.keyboard.press("Control+z")
  await expect(shot(page, 0)).toHaveAttribute("data-duration", "96")
  await page.keyboard.press("Control+Shift+z")
  await expect(shot(page, 0)).toHaveAttribute("data-duration", "95")
  await expect(shot(page, 1)).toHaveAttribute("data-start", "192")
})

test("occupied drops and Escape cancel without creating history; snapping can be disabled", async ({
  page
}) => {
  const px = await scale(page)
  await move(page, shot(page, 0).locator(".nle-clip-body"), px * 96, undefined, false)
  await expect(page.locator(".nle-drag-preview")).toHaveAttribute("data-valid", "false")
  await page.mouse.up()
  await expect(shot(page, 0)).toHaveAttribute("data-start", "0")
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled()
  const upper = (await track(page, 1).boundingBox())!
  await move(
    page,
    shot(page, 0).locator(".nle-clip-body"),
    px * 96,
    upper.y + upper.height / 2,
    false
  )
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(track(page, 0).locator('.cinema-clip[data-shot="0"]')).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled()
  await move(
    page,
    shot(page, 0).locator(".nle-clip-body"),
    px * 192 + 3,
    upper.y + upper.height / 2,
    false
  )
  await expect(page.locator(".nle-snap-line")).toBeVisible()
  await page.mouse.up()
  await expect(shot(page, 0)).toHaveAttribute("data-start", "192")
  await page.getByRole("button", { name: "Snap on", exact: true }).click()
  await move(page, shot(page, 0).locator(".nle-clip-body"), px * 12)
  await expect(shot(page, 0)).toHaveAttribute("data-start", "204")
})

test("zoomed timeline scrolls while dragging and keyboard moves by a second", async ({ page }) => {
  const zoom = page.getByRole("slider", { name: "Timeline zoom", exact: true })
  await zoom.focus()
  await page.keyboard.press("End")
  await expect(zoom).toHaveValue("4")
  const clip = shot(page, 1).locator(".nle-clip-body")
  await clip.focus()
  await page.keyboard.press("ArrowUp")
  await expect(track(page, 1).locator('.cinema-clip[data-shot="1"]')).toHaveCount(1)
  await clip.focus()
  await page.keyboard.press("Shift+ArrowRight")
  await expect(shot(page, 1)).toHaveAttribute("data-start", "216")
  await clip.scrollIntoViewIfNeeded()
  const viewport = (await page.locator(".nle-scroll").boundingBox())!
  const box = (await clip.boundingBox())!
  const before = await page.locator(".nle-scroll").evaluate((node) => node.scrollLeft)
  await move(
    page,
    clip,
    viewport.x + viewport.width - 12 - (box.x + box.width / 2),
    undefined,
    false
  )
  await expect
    .poll(() => page.locator(".nle-scroll").evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(before + 20)
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(shot(page, 1)).toHaveAttribute("data-start", "216")
  await page.getByRole("button", { name: "Fit", exact: true }).click()
  await expect(zoom).toHaveValue("1")
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test.describe("touch direct editing", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("touch trims a clip edge and undo restores it", async ({ page }) => {
    const handle = page.getByRole("button", { name: "Trim end of clip 01", exact: true })
    await handle.scrollIntoViewIfNeeded()
    const rect = (await handle.boundingBox())!
    const px = await scale(page)
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] })
      for (let step = 1; step <= 10; step++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: start.x - (px * 72 * step) / 10, y: start.y }]
        })
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    } finally {
      await cdp.detach()
    }
    await expect(shot(page, 0)).toHaveAttribute("data-duration", "120")
    await expect(shot(page, 1)).toHaveAttribute("data-start", "192")
    await page.getByRole("button", { name: "Undo last edit", exact: true }).tap()
    await expect(shot(page, 0)).toHaveAttribute("data-duration", "192")
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
