import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

test("recorded demo plays and its published receipt matches the visible workflow", async ({ page, request }) => {
  await page.goto("/demo/")
  const video = page.locator("video")
  await video.evaluate(async (element: HTMLVideoElement) => { await element.play() })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBe(34)
  const receipt = await (await request.get("/demo-evidence.json")).json()
  expect(receipt.verification.data.clips.map((clip: { start: number; end: number }) => [clip.start, clip.end])).toEqual([[0, 5], [5, 10], [10, 15]])
  expect(receipt.verification.data.saved).toBe(true)
  await expect(page.getByRole("heading", { name: "Video transcript" })).toBeVisible()
  const schema = await page.locator('script[type="application/ld+json"]').allTextContents()
  expect(schema.map(text => JSON.parse(text)).some(data => data["@type"] === "VideoObject" && data.duration === "PT34S")).toBe(true)
})

test("comparison and demo are accessible and fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ["/compare/", "/demo/"]) {
    await page.goto(route)
    await expect(page.locator("h1")).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([])
  }
})
