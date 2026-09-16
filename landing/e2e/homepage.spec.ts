import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import { readFileSync } from "node:fs"
import published from "../lib/published-release.json"
import manifest from "../../public-product-manifest.json"
import { safeFirstPrompt, product, sourceCatalog } from "../lib/product"
import AxeBuilder from "@axe-core/playwright"

const fixtureURL = `http://127.0.0.1:${process.env.LANDING_E2E_POSTHOG_PORT || 3161}`
const flag = "homepage-cinematic-2026"

test("page scroll scenes move with scrolling and reset when motion is paused", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/design-preview/")
  const studio = page.locator(".studio")
  await expect(studio).toHaveAttribute("data-motion", "playing")
  const story = page.locator("#features")
  await story.scrollIntoViewIfNeeded()
  const frame = page.locator(".studio-feature-art img")
  const transform = () => frame.evaluate(node => getComputedStyle(node).transform)
  await expect.poll(() => story.evaluate(node => node.style.getPropertyValue("--scene-progress"))).not.toBe("")
  const before = await transform()
  await page.mouse.wheel(0, 300)
  await expect.poll(transform).not.toBe(before)
  const toggle = page.getByRole("button", { name: "Motion on. Pause page animation", exact: true })
  await toggle.click()
  await expect(studio).toHaveAttribute("data-motion", "paused")
  await expect.poll(() => story.evaluate(node => node.style.getPropertyValue("--scene-progress"))).toBe("")
  const paused = await transform()
  await page.mouse.wheel(0, 200)
  expect(await transform()).toBe(paused)
  await expect(page.getByRole("heading", { name: "Organize. Assemble. Check the details." })).toBeVisible()
})
type CapturedEvent = { event: string; distinct_id: string; properties: Record<string, unknown> }
const state = async (request: APIRequestContext) => (await (await request.get(`${fixtureURL}/__state`)).json()) as { events: CapturedEvent[]; evaluations: unknown[] }
const setVariant = (request: APIRequestContext, variant: string | boolean) => request.post(`${fixtureURL}/__state`, { data: { variant } })
const copyButton = (page: Page) => page.getByRole("button", { name: /Copy.*safe.*prompt/i })
const browserErrors = new Map<Page, string[]>()

test.beforeEach(async ({ context, page }) => {
  browserErrors.set(page, [])
  page.on("pageerror", error => browserErrors.get(page)!.push(error.message))
  // No live analytics, external data, or executable downloads during local QA.
  await context.route("https://www.googletagmanager.com/**", route => route.fulfill({ status: 200, body: "" }))
  await context.route(/https:\/\/.*google-analytics\.com\//, route => route.abort())
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([])
  browserErrors.delete(page)
})

for (const variant of ["control", "test"]) {
  test(`${variant}: published repo facts, safe prompt, and actual setup destinations`, async ({ page, request }) => {
    await setVariant(request, variant)
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
    expect(response?.headers()["cache-control"]).toContain("no-store")
    await expect(page.locator("h1")).toHaveText(variant === "test" ? /Your assistant[\s\S]*Premiere/ : /MCP for Adobe Premiere Pro:/)
    await expect.poll(async () => (await state(request)).events.filter(event => event.event === "$experiment_exposure").length).toBe(1)
    expect(product.version).toBe(published.version)
    expect(product.coreToolCount).toBe(published.coreTools)
    expect(manifest.generatedFrom.evidenceScope).toBe("source_checkout_not_published_package")
    expect(manifest.capabilitySurface.registeredCoreTools).toBe(sourceCatalog.coreTools)
    await expect(page.locator("body")).toContainText(String(published.coreTools))
    await expect(page.locator("body")).toContainText(safeFirstPrompt)
    expect(readFileSync("../README.md", "utf8")).toContain(safeFirstPrompt)
    await expect(page.locator(`a[href="${product.downloads.claudeBundle}"]`).first()).toBeVisible()
    await expect(page.locator(`a[href="${product.downloads.signedCepConnector}"]`).first()).toBeVisible()
    await copyButton(page).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(safeFirstPrompt)
    await expect.poll(async () => (await state(request)).events.some(event => event.event === "homepage_safe_prompt_copied")).toBe(true)
    const events = (await state(request)).events
    const exposure = events.find(event => event.event === "$experiment_exposure")!
    const conversion = events.find(event => event.event === "homepage_safe_prompt_copied")!
    expect(exposure.distinct_id).toBe(conversion.distinct_id)
    expect(exposure.properties.$feature_flag).toBe(flag)
    expect(exposure.properties.$feature_flag_response).toBe(variant)
    expect(conversion.properties[`$feature/${flag}`]).toBe(variant)
    expect(JSON.stringify(events)).not.toContain(safeFirstPrompt)
    await page.route(product.downloads.claudeBundle, route => route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "Content-Disposition": `attachment; filename="premiere-pro-mcp-${published.version}.mcpb"` },
      body: "Local fixture; not an executable bundle.",
    }))
    const downloadPromise = page.waitForEvent("download")
    await page.locator(`a[href="${product.downloads.claudeBundle}"]`).first().click()
    expect((await downloadPromise).suggestedFilename()).toBe(`premiere-pro-mcp-${published.version}.mcpb`)
    await expect.poll(async () => (await state(request)).events.some(event => event.event === "homepage_setup_downloaded")).toBe(true)
  })

  for (const destination of ["/docs/", "/tools/", "/workflows/", "/project-intake/", "/blog/", "/facts/", "/changelog/", "/privacy/"]) {
    test(`${variant}: returns from ${destination} to the same assigned homepage`, async ({ page, request }) => {
      await setVariant(request, variant)
      const exposed = page.waitForResponse(response =>
        response.url().endsWith("/api/landing-events") &&
        response.request().postDataJSON()?.event === "homepage_experiment_exposed"
      )
      await page.goto("/")
      expect((await exposed).status()).toBe(204)
      await expect.poll(async () => (await state(request)).events.some(event => event.event === "$experiment_exposure")).toBe(true)
      const identity = (await page.context().cookies()).find(cookie => cookie.name === "premiere_homepage_v1")!.value.split(".")[0]
      await page.getByRole("navigation", { name: "Footer navigation" }).locator(`a[href="${destination}"]`).click()
      await expect(page).toHaveURL(new RegExp(`${destination}$`))
      await page.locator('a[href="/"]').first().click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.locator("h1")).toHaveText(variant === "test" ? /Your assistant[\s\S]*Premiere/ : /MCP for Adobe Premiere Pro:/)
      expect((await page.context().cookies()).find(cookie => cookie.name === "premiere_homepage_v1")!.value.split(".")[0]).toBe(identity)
      await copyButton(page).click()
      await expect.poll(async () => (await state(request)).events.some(event => event.event === "homepage_safe_prompt_copied" && event.properties.variant === variant)).toBe(true)
    })
  }
}

test("treatment: all homepage anchors and local footer destinations resolve", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  const links = await page.locator('a[href^="/"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute("href")!))])
  for (const href of links) {
    const response = await request.get(href)
    expect(response.status(), href).toBe(200)
    const hash = new URL(href, "http://localhost").hash.slice(1)
    if (hash) expect(await response.text(), href).toContain(`id="${hash}"`)
  }
  const missing = await page.locator('a[href^="#"]').evaluateAll(nodes => nodes.map(node => node.getAttribute("href")!.slice(1)).filter(id => !document.getElementById(id)))
  expect(missing).toEqual([])
})

for (const variant of ["control", "test"]) {
test(`${variant}: responsive layout, semantic structure, and accessible controls`, async ({ page, request }) => {
  await setVariant(request, variant)
  await page.goto("/")
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `overflow at ${width}`).toBeLessThanOrEqual(width)
    await expect(page.getByRole("main")).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    if (width === 390 || width === 1440) {
      const audit = await new AxeBuilder({ page }).analyze()
      expect(audit.violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`homepage-${variant}-${width}.png`), fullPage: true })
    }
  }
})
}

test("treatment: workflow chapters, Codex guide, manual setup, FAQs, and clipboard recovery", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  await page.getByRole("tab", { name: /02 Organize project media/ }).click()
  await expect(page.getByRole("tabpanel", { name: /02 Organize project media/ })).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByRole("tab", { name: /03 Check effects and exports/ })).toHaveAttribute("aria-selected", "true")
  for (const [name, href] of [
    ["Codex", "/blog/codex-premiere-pro-mcp-setup/"],
    ["Cursor", "/blog/how-to-set-up-premiere-pro-mcp/"],
    ["VS Code / Copilot", product.links.readme],
    ["Another client", "/docs/"],
  ]) {
    await page.getByRole("tab", { name, exact: true }).click()
    await expect(page.locator('.studio-client-content[data-state="active"] a').first()).toHaveAttribute("href", href)
  }
  await page.getByRole("tab", { name: "Codex", exact: true }).click()
  await page.getByRole("link", { name: "Open Codex setup guide" }).click()
  await expect(page.locator("main")).toContainText("codex plugin add premiere-pro@premiere-pro-mcp")
  await page.locator('a[href="/"]').first().click()
  await expect(page.locator("h1")).toHaveText(/Your assistant[\s\S]*Premiere/)
  await expect.poll(async () => (await state(request)).events.some(event => event.event === "primary_cta_clicked" && event.properties.destination === "codex")).toBe(true)
  expect((await state(request)).events.filter(event => event.event === "homepage_setup_downloaded")).toHaveLength(0)
  await page.getByRole("button", { name: "Advanced setup & compatibility" }).click()
  await expect(page.locator("body")).toContainText("Install the correct package")
  await expect(page.locator("body")).toContainText(`npm i -g premiere-pro-mcp@${published.version}`)
  await expect(page.locator("body")).toContainText("adobe-premiere-pro-mcp")
  await expect(page.locator("body")).toContainText("Verify you have the right install")
  await expect(page.locator("body")).toContainText("npm list -g premiere-pro-mcp")
  await page.getByRole("button", { name: "Copy installation commands" }).click()
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(`npx --yes premiere-pro-mcp@${published.version} --install-cep\nnpx --yes premiere-pro-mcp@${published.version} --doctor`)
  await expect(page.locator("body")).toContainText(`Node.js ${published.nodeVersion}+`)
  await page.getByRole("button", { name: "Does MCP for Adobe Premiere Pro upload my footage?" }).click()
  await expect(page.locator("body")).toContainText("Your AI assistant’s separate privacy settings still apply.")
  await page.getByRole("button", { name: "Need help connecting?" }).click()
  await expect(page.getByRole("link", { name: "Open setup and recovery" })).toHaveAttribute("href", "/docs/troubleshooting/")
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Clipboard denied by local test") } })
  await copyButton(page).click()
  await expect(page.getByText("Clipboard unavailable. Select and copy the text above.")).toBeVisible()
  expect((await state(request)).events.filter(event => event.event === "homepage_safe_prompt_copied")).toHaveLength(0)
})

test.describe("touch navigation", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("mobile menu follows section links, closes with Escape, and restores focus", async ({ page, request }) => {
    await setVariant(request, "test")
    await page.goto("/")
    await page.getByRole("button", { name: "Open navigation" }).tap()
    await page.getByRole("dialog").getByRole("link", { name: "Connect to Premiere" }).tap()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page).toHaveURL(/#install$/)
    await page.getByRole("button", { name: "Open navigation" }).tap()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused()
    await page.getByRole("tab", { name: "Codex", exact: true }).tap()
    await expect(page.getByRole("link", { name: "Open Codex setup guide" })).toBeVisible()
  })
})

test("treatment: reduced motion, animated WebGL, pause, context loss, and video playback", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  await expect(page.locator(".studio")).toHaveAttribute("data-motion", "paused")
  await expect(page.locator("canvas")).toHaveCount(0)
  await page.getByRole("button", { name: "3D overview", exact: true }).click()
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(page.locator(".studio-stage")).toHaveAttribute("data-enhanced", "true")
  await page.getByRole("button", { name: /Pause page animation/ }).click()
  await expect(page.locator("canvas")).toHaveCount(0)
  await page.getByRole("button", { name: /Enable page animation/ }).click()
  await expect(page.locator(".studio-stage")).toHaveAttribute("data-enhanced", "true")
  await page.locator("canvas").evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2")
    if (!context) throw new Error("Expected a WebGL2 renderer")
    context.getExtension("WEBGL_lose_context")!.loseContext()
  })
  await expect(page.locator(".studio-stage")).toHaveAttribute("data-enhanced", "false")
  await expect(page.getByRole("img", { name: /Three coastal film shots/ })).toBeVisible()
  await page.getByRole("button", { name: /Play the walkthrough/ }).click()
  await expect.poll(async () => page.locator("video").evaluate(video => ({ ready: (video as HTMLVideoElement).readyState >= 2, playing: !(video as HTMLVideoElement).paused, time: (video as HTMLVideoElement).currentTime > 0 }))).toEqual({ ready: true, playing: true, time: true })
  await expect(page.locator("video")).toHaveAttribute("aria-label", /Live Premiere Pro recording/)
  await expect.poll(async () => page.locator("video").evaluate(video => ({ muted: (video as HTMLVideoElement).muted, duration: Math.round((video as HTMLVideoElement).duration) }))).toEqual({ muted: false, duration: 30 })
})

test("cutting room: chapters work with keyboard, reduced motion, and a lost WebGL context", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  const first = page.getByRole("button", { name: "01 The first frame" })
  await first.focus()
  await page.keyboard.press("Enter")
  await expect(first).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".cinema-caption")).toContainText("Review your selects.")
  await expect(page.locator("canvas")).toHaveCount(0)
  await page.keyboard.press("Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.press("Space")
  await expect(page.getByRole("button", { name: "03 The final look" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".cinema-caption")).toContainText("Review the final look.")
  await page.getByRole("button", { name: "3D overview", exact: true }).click()
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(page.locator(".studio-stage")).toHaveAttribute("data-enhanced", "true")
  await page.locator("canvas").evaluate(canvas => {
    (canvas as HTMLCanvasElement).getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext()
  })
  await expect(page.getByRole("img", { name: /Three coastal film shots/ })).toBeVisible()
  await first.click()
  await expect(page.locator(".cinema-caption")).toContainText("Review your selects.")
})

test("editing timeline: keyboard scrubbing, playback, replay, and clip selection stay synchronized", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  const scrubber = page.getByRole("slider", { name: "Scrub editing timeline" })
  const time = page.getByLabel("Current timecode")
  await scrubber.focus()
  await page.keyboard.press("Home")
  await expect(time).toHaveText("00:00:00:00")
  await page.keyboard.press("ArrowRight")
  await expect(time).toHaveText("00:00:00:01")
  await page.keyboard.press("End")
  await expect(time).toHaveText("00:00:23:23")
  await expect(page.getByRole("button", { name: "Select clip 03: Into the blue" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Replay sequence", exact: true }).click()
  await expect.poll(async () => Number(await scrubber.inputValue())).toBeLessThan(48)
  await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(2)
  await page.getByRole("button", { name: "Pause sequence", exact: true }).click()
  const stopped = await scrubber.inputValue()
  await page.waitForTimeout(150)
  await expect(scrubber).toHaveValue(stopped)
  await page.getByRole("button", { name: "Select clip 02: Follow the coastline" }).click()
  await expect(time).toHaveText("00:00:10:00")
  await expect(page.locator(".cinema-caption")).toContainText("Arrange the sequence.")
})

test("editing timeline: mouse dragging and separated 3D layers remain clickable", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.locator(".cinema-editing-desk").scrollIntoViewIfNeeded()
  // Exercise adjacent clip faces on the fixed perspective desk.
  // A transparent track container previously intercepted intermittent clicks.
  for (let pass = 0; pass < 4; pass++) {
    for (const [name, value] of [
      ["Select clip 01: A moment of stillness", "00:00:02:00"],
      ["Select clip 02: Follow the coastline", "00:00:10:00"],
      ["Select clip 03: Into the blue", "00:00:18:00"]
    ]) {
      await page.getByRole("button", { name, exact: true }).click()
      await expect(page.getByLabel("Current timecode")).toHaveText(value)
    }
  }
  await page.getByRole("button", { name: "Separate layers", exact: true }).click()
  await expect(page.locator(".cinema-editing-desk")).toHaveAttribute("data-exploded", "true")
  for (const [name, value] of [["Select clip 01: A moment of stillness", "00:00:02:00"], ["Select clip 03: Into the blue", "00:00:18:00"]]) {
    await page.getByRole("button", { name, exact: true }).click()
    await expect(page.getByLabel("Current timecode")).toHaveText(value)
  }
  await page.getByRole("button", { name: "Bring layers together", exact: true }).click()
  const scrubber = page.getByRole("slider", { name: "Scrub editing timeline" })
  await scrubber.scrollIntoViewIfNeeded()
  await scrubber.focus()
  await page.keyboard.press("Home")
  // Chromium's projected quad keeps the drag on the actual tilted ruler.
  // An axis-aligned bounding box can put the pointer outside a 3D control.
  const cdp = await page.context().newCDPSession(page)
  try {
    const { root } = await cdp.send("DOM.getDocument")
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".cinema-scrubber" })
    const quad = async () => (await cdp.send("DOM.getContentQuads", { nodeId })).quads[0]
    const point = (q: number[], t: number) => ({
      x: (q[0] + q[6]) * .5 * (1 - t) + (q[2] + q[4]) * .5 * t,
      y: (q[1] + q[7]) * .5 * (1 - t) + (q[3] + q[5]) * .5 * t
    })
    let corners = await quad()
    let from = point(corners, .007)
    await page.mouse.move(from.x, from.y)
    await page.waitForTimeout(700) // Let pointer parallax settle before gripping the thumb.
    corners = await quad()
    from = point(corners, .007)
    const to = point(corners, .82)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 24 })
    await page.mouse.up()
  } finally {
    await cdp.detach()
  }
  await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(400)
  await expect(page.getByRole("button", { name: "Select clip 03: Into the blue" })).toHaveAttribute("aria-pressed", "true")
})

test("MCP demo: guided edits change the sequence, show tool calls, and undo independently", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  const order = () => page.locator(".cinema-clip").evaluateAll(clips => clips.map(clip => clip.getAttribute("data-shot")))
  const duration = page.getByLabel("Sequence duration")
  const status = page.locator(".cinema-workflow-status")
  await page.getByRole("button", { name: "Trim opening to 4s", exact: true }).click()
  await expect(page.getByRole("button", { name: "Put the blue shot first", exact: true })).toBeDisabled()
  await expect(status).toContainText("Opening trimmed to 4s")
  await expect(duration).toHaveText("/ 00:00:20:00")
  await expect(page.getByRole("slider", { name: "Scrub editing timeline" })).toHaveAttribute("max", "479")
  await page.getByText("See example tool calls", { exact: true }).click()
  await expect(page.locator(".cinema-tool-details pre")).toContainText('"new_out_seconds": 4')
  await expect(page.locator(".cinema-tool-details pre")).toContainText("get_sequence_structure")
  await expect(page.locator(".cinema-tool-details")).toContainText("no live Premiere connection")
  await page.getByText("See example tool calls", { exact: true }).click()
  await page.getByRole("button", { name: "Put the blue shot first", exact: true }).click()
  await expect(status).toContainText("Into the blue now opens the film")
  expect(await order()).toEqual(["2", "0", "1"])
  await expect(page.locator(".cinema-caption")).toContainText("Review the final look.")
  await expect(page.getByLabel("Current timecode")).toHaveText("00:00:02:00")
  await page.getByRole("button", { name: "Mark this frame", exact: true }).click()
  await expect(status).toContainText("Review marker added")
  await expect(page.getByRole("button", { name: "Review this frame at 00:00:02:00", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Mark this frame", exact: true }).click()
  await expect(status).toContainText("already a review marker")
  await expect(page.locator(".cinema-review-marker")).toHaveCount(1)
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  await expect(page.locator(".cinema-review-marker")).toHaveCount(0)
  expect(await order()).toEqual(["2", "0", "1"])
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  expect(await order()).toEqual(["0", "1", "2"])
  await expect(duration).toHaveText("/ 00:00:20:00")
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  await expect(duration).toHaveText("/ 00:00:24:00")
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled()
})

test("MCP demo: reorder by keyboard, ripple trim, and reset", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const clips = page.locator(".cinema-clip")
  const order = () => clips.evaluateAll(items => items.map(item => item.getAttribute("data-shot")))
  const firstShot = page.getByRole("button", { name: "Select clip 01: A moment of stillness", exact: true })
  await firstShot.click()
  await expect(firstShot).toHaveAttribute("aria-pressed", "true")
  await firstShot.focus()
  await page.keyboard.press("Alt+ArrowRight")
  await expect.poll(order).toEqual(["1", "0", "2"])
  const trim = page.getByRole("slider", { name: "Selected clip duration", exact: true })
  await trim.focus()
  await page.keyboard.press("Home")
  await expect(trim).toHaveValue("24")
  await expect(page.getByLabel("Sequence duration")).toHaveText("/ 00:00:17:00")
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  await expect(page.getByLabel("Sequence duration")).toHaveText("/ 00:00:24:00")
  await expect.poll(order).toEqual(["1", "0", "2"])
  // A continuous slider gesture creates one undo step, not one per frame.
  await trim.scrollIntoViewIfNeeded()
  const range = (await trim.boundingBox())!
  await page.mouse.move(range.x + range.width - 8, range.y + range.height / 2)
  await page.mouse.down()
  await page.mouse.move(range.x + 8, range.y + range.height / 2, { steps: 18 })
  await page.mouse.up()
  await expect(page.getByLabel("Sequence duration")).toHaveText("/ 00:00:17:00")
  await page.getByRole("button", { name: "Undo last edit", exact: true }).click()
  await expect(page.getByLabel("Sequence duration")).toHaveText("/ 00:00:24:00")
  await page.getByRole("button", { name: "Reset demo sequence", exact: true }).click()
  await expect.poll(order).toEqual(["0", "1", "2"])
  await expect(page.getByLabel("Current timecode")).toHaveText("00:00:10:00")
  await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeDisabled()
})

test.describe("touch editing timeline", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("touch clips and layer controls work without WebGL", async ({ page, request }) => {
    await setVariant(request, "test")
    await page.goto("/")
    await page.getByRole("button", { name: "Separate layers", exact: true }).tap()
    await page.getByRole("button", { name: "Select clip 01: A moment of stillness" }).tap()
    await expect(page.getByLabel("Current timecode")).toHaveText("00:00:02:00")
    await page.getByRole("button", { name: "Select clip 03: Into the blue" }).tap()
    await expect(page.getByLabel("Current timecode")).toHaveText("00:00:18:00")
    await expect(page.locator("canvas")).toHaveCount(0)
    const desk = (await page.locator(".cinema-deck").boundingBox())!
    expect(desk.x).toBeGreaterThanOrEqual(0)
    expect(desk.x + desk.width).toBeLessThanOrEqual(390)
  })
  test("MCP requests, clip ordering, markers, and undo work on touch", async ({ page, request }) => {
    await setVariant(request, "test")
    await page.goto("/")
    await page.getByRole("button", { name: "Trim opening to 4s", exact: true }).tap()
    await expect(page.locator(".cinema-workflow-status")).toContainText("Opening trimmed to 4s")
    await page.getByRole("button", { name: "Select clip 03: Into the blue", exact: true }).tap()
    await page.getByRole("button", { name: "Move selected clip earlier", exact: true }).tap()
    expect(await page.locator(".cinema-clip").evaluateAll(clips => clips.map(clip => clip.getAttribute("data-shot")))).toEqual(["0", "2", "1"])
    await page.getByRole("button", { name: "Mark this frame", exact: true }).tap()
    await expect(page.locator(".cinema-workflow-status")).toContainText("Review marker added")
    await page.getByRole("button", { name: "Return to first frame", exact: true }).tap()
    await page.getByRole("button", { name: "Review this frame at 00:00:06:00", exact: true }).tap()
    await expect(page.getByLabel("Current timecode")).toHaveText("00:00:06:00")
    await page.getByRole("button", { name: "Undo last edit", exact: true }).tap()
    await expect(page.locator(".cinema-review-marker")).toHaveCount(0)
    await expect(page.locator("canvas")).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.getByRole("button", { name: "Reset demo sequence", exact: true }).tap()
    await page.locator(".nle-workspace").scrollIntoViewIfNeeded()
    const from = (await page.locator(".cinema-clip").first().boundingBox())!
    const to = (await page.getByRole("group", { name: "Video track 2", exact: true }).boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    try {
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      const end = { x: start.x, y: to.y + to.height / 2 }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] })
      for (let step = 1; step <= 12; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 12, y: start.y + (end.y - start.y) * step / 12 }] })
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    } finally {
      await cdp.detach()
    }
    await expect(page.getByRole("group", { name: "Video track 2", exact: true }).locator('.cinema-clip[data-shot="0"]')).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Undo last edit", exact: true })).toBeEnabled()
  })
})

for (const [label, headers] of [["DNT", { DNT: "1" }], ["GPC", { "Sec-GPC": "1" }], ["crawler", { "User-Agent": "Googlebot" }]] as const) {
  test.describe(label, () => {
    test.use(label === "crawler" ? { userAgent: "Googlebot" } : { extraHTTPHeaders: headers })
  test(`${label}: no assignment, provider evaluation, or conversion`, async ({ page, context, request }) => {
    await setVariant(request, "test")
    await page.goto("/")
    await expect(page.locator("h1")).toHaveText(/MCP for Adobe Premiere Pro:/)
    await copyButton(page).click()
    expect((await context.cookies()).some(cookie => cookie.name === "premiere_homepage_v1")).toBe(false)
    expect((await state(request)).evaluations).toHaveLength(0)
    expect((await state(request)).events.filter(event => event.event.startsWith("homepage_") || event.event === "$experiment_exposure")).toHaveLength(0)
  })
  })
}

for (const variant of [false, "unavailable"]) {
  test(`${variant}: disabled or unavailable PostHog falls back to control without enrollment`, async ({ page, context, request }) => {
    await setVariant(request, variant)
    await page.goto("/")
    await expect(page.locator("h1")).toHaveText(/MCP for Adobe Premiere Pro:/)
    await copyButton(page).click()
    expect((await context.cookies()).some(cookie => cookie.name === "premiere_homepage_v1")).toBe(false)
    expect((await state(request)).events.filter(event => event.event.startsWith("homepage_") || event.event === "$experiment_exposure")).toHaveLength(0)
  })
}

test("preview URLs never enroll or replace an existing assignment", async ({ page, context, request }) => {
  await setVariant(request, "control")
  await page.goto("/")
  await expect.poll(async () => (await state(request)).events.filter(event => event.event === "$experiment_exposure").length).toBe(1)
  const cookie = (await context.cookies()).find(cookie => cookie.name === "premiere_homepage_v1")!.value
  for (const path of ["/?design=test", "/design-preview/", "/?design=control"]) {
    const response = await page.goto(path)
    expect(response?.headers()["x-robots-tag"]).toContain("noindex")
    await copyButton(page).click()
    expect((await context.cookies()).find(cookie => cookie.name === "premiere_homepage_v1")!.value).toBe(cookie)
  }
  expect((await state(request)).events.filter(event => event.event === "$experiment_exposure")).toHaveLength(1)
  expect((await state(request)).events.filter(event => event.event === "homepage_safe_prompt_copied")).toHaveLength(0)
})

test("no JavaScript: treatment content, setup downloads, and document links remain usable", async ({ browser, request, baseURL }) => {
  await setVariant(request, "test")
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, userAgent: "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36" })
  const page = await context.newPage()
  await page.goto("/")
  await expect(page.locator("h1")).toHaveText(/Your assistant[\s\S]*Premiere/)
  await expect(page.locator(`a[href="${product.downloads.claudeBundle}"]`)).toBeVisible()
  await page.locator(".site-desktop-nav summary").filter({ hasText: "Get started" }).click()
  await page.locator('.site-desktop-nav a[href="/docs/"]').click()
  await page.locator('a[href="/"]').first().click()
  await expect(page.locator("h1")).toHaveText(/Your assistant[\s\S]*Premiere/)
  expect((await state(request)).events.filter(event => event.event === "$experiment_exposure")).toHaveLength(0)
  await context.close()
})

test("a fast copy waits for exposure acknowledgement before recording a conversion", async ({ page, request }) => {
  await setVariant(request, "test")
  let releaseExposure = () => {}
  const exposureGate = new Promise<void>(resolve => { releaseExposure = resolve })
  let exposureStarted = false
  const submitted: string[] = []
  await page.route("**/api/landing-events", async route => {
    const event = route.request().postDataJSON().event as string
    submitted.push(event)
    if (event === "homepage_experiment_exposed") {
      exposureStarted = true
      await exposureGate
    }
    await route.continue()
  })
  try {
    await page.goto("/")
    await expect.poll(() => exposureStarted).toBe(true)
    await copyButton(page).click()
    expect(submitted.every(event => event === "homepage_experiment_exposed")).toBe(true)
    expect(submitted.length).toBeGreaterThanOrEqual(1)
    expect(submitted).not.toContain("onboarding_safe_prompt_copied")
    releaseExposure()
    await expect.poll(async () => (await state(request)).events.some(event => event.event === "homepage_safe_prompt_copied")).toBe(true)
    const events = (await state(request)).events
    expect(events.findIndex(event => event.event === "$experiment_exposure")).toBeLessThan(events.findIndex(event => event.event === "homepage_safe_prompt_copied"))
  } finally {
    releaseExposure()
  }
})

test("the production collector rejects wrong variants, foreign origins, oversized input, and forged cookies", async ({ page, request, baseURL }) => {
  await setVariant(request, "test")
  const response = await page.goto("/")
  expect(response?.headers()["content-security-policy"]).toContain("'nonce-")
  expect(response?.headers()["content-encoding"]).toBe("gzip")
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://premiere-pro-mcp.com/")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow")
  await expect.poll(async () => (await state(request)).events.some(event => event.event === "$experiment_exposure")).toBe(true)
  await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === "premiere_homepage_v1")?.value.split(".")[3]).toBe("1")
  const signedCookie = (await page.context().cookies()).find(cookie => cookie.name === "premiere_homepage_v1")!
  // Chromium permits Secure localhost cookies. Playwright's separate HTTP
  // client requires an explicit test-cookie header on this HTTP fixture.
  const post = (data: unknown, headers: Record<string, string> = {}) => page.request.post("/api/landing-events", { data, headers: { Origin: baseURL!, Cookie: `${signedCookie.name}=${signedCookie.value}`, ...headers } })
  expect((await post({ event: "onboarding_safe_prompt_copied", variant: "control" })).status()).toBe(400)
  expect((await post({ event: "onboarding_safe_prompt_copied", variant: "test" }, { Origin: "https://foreign.example" })).status()).toBe(403)
  expect((await post({ event: "onboarding_safe_prompt_copied", variant: "test", parameters: { route: "x".repeat(2048) } })).status()).toBe(413)
  expect((await post({ event: "private_project_uploaded", variant: "test" })).status()).toBe(400)
  expect((await post({ event: "onboarding_safe_prompt_copied", variant: "test" }, { Cookie: "premiere_homepage_v1=forged" })).status()).toBe(204)
  expect((await state(request)).events.filter(event => event.event === "homepage_safe_prompt_copied")).toHaveLength(0)
})

test("concurrent visitors receive exposure and conversion delivery without another event to flush the queue", async ({ playwright, request, baseURL }) => {
  await setVariant(request, "test")
  const clients = await Promise.all(Array.from({ length: 12 }, () => playwright.request.newContext({
    baseURL,
    userAgent: "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36",
  })))
  try {
    const identities = await Promise.all(clients.map(async client => {
      const document = await client.get("/")
      const cookie = document.headers()["set-cookie"].split(";")[0]
      const exposed = await client.post("/api/landing-events", {
        headers: { Origin: baseURL!, Cookie: cookie },
        data: { event: "homepage_experiment_exposed", variant: "test" },
      })
      expect(exposed.status()).toBe(204)
      const converted = await client.post("/api/landing-events", {
        headers: { Origin: baseURL!, Cookie: exposed.headers()["set-cookie"].split(";")[0] },
        data: { event: "onboarding_safe_prompt_copied", variant: "test" },
      })
      expect(converted.status()).toBe(204)
      return cookie.split("=")[1].split(".")[0]
    }))
    await expect.poll(async () => {
      const events = (await state(request)).events
      return identities.filter(id => events.some(event => event.distinct_id === id && event.event === "homepage_safe_prompt_copied")).length
    }).toBe(12)
    const events = (await state(request)).events
    for (const id of identities) {
      const exposure = events.findIndex(event => event.distinct_id === id && event.event === "$experiment_exposure")
      const conversion = events.findIndex(event => event.distinct_id === id && event.event === "homepage_safe_prompt_copied")
      expect(exposure).toBeGreaterThanOrEqual(0)
      expect(exposure).toBeLessThan(conversion)
    }
  } finally {
    await Promise.all(clients.map(client => client.dispose()))
  }
})
