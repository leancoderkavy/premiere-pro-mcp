import { test, expect } from "@playwright/test"

test("program monitor sits directly above the timeline and both playheads stay synchronized", async ({
  page
}) => {
  await page.goto("/design-preview/#editing-timeline")
  const monitor = page.getByRole("region", { name: "Program monitor", exact: true })
  await expect(monitor).toHaveAttribute("data-view", "program")
  const monitorBox = (await monitor.boundingBox())!
  const timelineBox = (await page.locator(".cinema-deck").boundingBox())!
  expect(timelineBox.y - monitorBox.y - monitorBox.height).toBeGreaterThanOrEqual(0)
  expect(timelineBox.y - monitorBox.y - monitorBox.height).toBeLessThanOrEqual(8)
  expect(Math.abs(timelineBox.x - monitorBox.x)).toBeLessThan(2)
  await expect(page.locator(".cinema-program-monitor + .cinema-nle")).toHaveCount(1)
  const jog = page.getByRole("slider", { name: "Program monitor playhead", exact: true })
  const ruler = page.getByRole("slider", { name: "Scrub editing timeline", exact: true })
  await jog.focus()
  await page.keyboard.press("Home")
  await expect(ruler).toHaveValue("0")
  await expect(page.locator(".program-picture")).toHaveAttribute("data-shot", "0")
  await page.getByRole("button", { name: "Step forward one frame", exact: true }).click()
  await expect(jog).toHaveValue("1")
  await expect(ruler).toHaveValue("1")
  await expect(page.getByLabel("Source timecode", { exact: true })).toHaveText("SRC 00:00:00:01")
  await page.getByRole("button", { name: "Go to last frame", exact: true }).click()
  await expect(jog).toHaveValue("575")
  await expect(page.locator(".program-picture")).toHaveAttribute("data-shot", "2")
  await expect(
    page.getByRole("button", { name: "Step forward one frame", exact: true })
  ).toBeDisabled()
  await page.getByRole("button", { name: "Step back one frame", exact: true }).click()
  await expect(ruler).toHaveValue("574")
  await expect(page.getByLabel("Source timecode", { exact: true })).toHaveText("SRC 00:00:07:22")
  await ruler.focus()
  await page.keyboard.press("Home")
  await expect(jog).toHaveValue("0")
  await page.getByRole("button", { name: "Safe margins", exact: true }).click()
  await expect(page.locator(".program-safe-margins")).toBeVisible()
  await page
    .getByRole("combobox", { name: "Monitor magnification", exact: true })
    .selectOption("150")
  await expect(page.locator(".program-picture")).toHaveAttribute("data-zoom", "150")
})

test("program picture follows edited source ranges and gaps, with 3D opt-in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/design-preview/#editing-timeline")
  await expect(page.locator("canvas")).toHaveCount(0)
  const clip = page.getByRole("button", {
    name: "Select clip 01: A moment of stillness",
    exact: true
  })
  await clip.focus()
  await page.keyboard.press("ArrowUp")
  await clip.focus()
  await page.keyboard.press("Shift+ArrowRight")
  await expect(page.locator(".program-picture")).toHaveAttribute("data-shot", "0")
  await expect(page.locator(".program-picture")).toHaveAttribute("data-source-frame", "48")
  await page.getByRole("button", { name: "Return to first frame", exact: true }).click()
  await expect(page.locator(".cinema-gap")).toBeVisible()
  await expect(page.locator(".program-picture")).toHaveCount(0)
  await clip.click()
  await page.getByRole("button", { name: "3D overview", exact: true }).click()
  await expect(page.locator(".studio-stage")).toHaveAttribute("data-enhanced", "true")
  await page.getByRole("button", { name: "3D overview", exact: true }).click()
  await expect(page.locator("canvas")).toHaveCount(0)
  await expect(page.locator(".program-picture")).toHaveAttribute("data-source-frame", "48")
})

test.describe("touch program monitor", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("touch playback and single-frame controls respond once per tap", async ({ page }) => {
    await page.goto("/design-preview/#editing-timeline")
    await page.getByRole("button", { name: "Return to first frame", exact: true }).tap()
    await page.getByRole("button", { name: "Step forward one frame", exact: true }).tap()
    await expect(page.getByLabel("Current timecode", { exact: true })).toHaveText("00:00:00:01")
    await page.getByRole("button", { name: "Play sequence", exact: true }).tap()
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole("slider", { name: "Program monitor playhead", exact: true })
            .inputValue()
        )
      )
      .toBeGreaterThan(2)
    await page.getByRole("button", { name: "Pause sequence", exact: true }).tap()
    await expect(page.getByRole("button", { name: "Play sequence", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Safe margins", exact: true }).tap()
    await expect(page.locator(".program-safe-margins")).toBeVisible()
    const monitor = (await page.locator(".cinema-program-monitor").boundingBox())!
    const timeline = (await page.locator(".cinema-deck").boundingBox())!
    expect(timeline.y - monitor.y - monitor.height).toBeLessThanOrEqual(8)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page
      .locator("#editing-timeline")
      .screenshot({ path: test.info().outputPath("touch-program-monitor.png") })
  })
})
