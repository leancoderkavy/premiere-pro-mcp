import { test, expect, type Page, type APIRequestContext } from "@playwright/test"
import { readFileSync } from "node:fs"
import published from "../lib/published-release.json"
import manifest from "../../public-product-manifest.json"
import { safeFirstPrompt, product } from "../lib/product"
import AxeBuilder from "@axe-core/playwright"

const fixtureURL = `http://127.0.0.1:${process.env.LANDING_E2E_POSTHOG_PORT || 3161}`
const flag = "homepage-cinematic-2026"
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
    await expect(page.locator("h1")).toHaveText(variant === "test" ? /Your vision[\s\S]*timeline/ : /MCP for Adobe Premiere Pro:/)
    await expect.poll(async () => (await state(request)).events.filter(event => event.event === "$experiment_exposure").length).toBe(1)
    expect(published.version).toBe(manifest.product.version)
    expect(published.coreTools).toBe(manifest.capabilitySurface.registeredCoreTools)
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
      await page.locator(`a[href="${destination}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`${destination}$`))
      await page.locator('a[href="/"]').first().click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page.locator("h1")).toHaveText(variant === "test" ? /Your vision[\s\S]*timeline/ : /MCP for Adobe Premiere Pro:/)
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

test("treatment: responsive layout, semantic structure, and accessible controls", async ({ page, request }) => {
  await setVariant(request, "test")
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
      await page.screenshot({ path: test.info().outputPath(`homepage-${width}.png`), fullPage: true })
    }
  }
})

test("treatment: workflow chapters, Codex guide, manual setup, FAQs, and clipboard recovery", async ({ page, request }) => {
  await setVariant(request, "test")
  await page.goto("/")
  await page.getByRole("tab", { name: /02 Find your focus/ }).click()
  await expect(page.getByRole("tabpanel", { name: /02 Find your focus/ })).toBeVisible()
  await page.getByRole("tab", { name: /03 Sweat the details/ }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("tab", { name: /03 Sweat the details/ })).toHaveAttribute("aria-selected", "true")
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
  await expect(page.locator("h1")).toHaveText(/Your vision[\s\S]*timeline/)
  await expect.poll(async () => (await state(request)).events.some(event => event.event === "primary_cta_clicked" && event.properties.destination === "codex")).toBe(true)
  expect((await state(request)).events.filter(event => event.event === "homepage_setup_downloaded")).toHaveLength(0)
  await page.getByRole("button", { name: "Advanced setup & compatibility" }).click()
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
  await expect(page.getByRole("img", { name: /Original cinematic artwork/ })).toBeVisible()
  await page.getByRole("button", { name: /Play the walkthrough/ }).click()
  await expect.poll(async () => page.locator("video").evaluate(video => ({ ready: (video as HTMLVideoElement).readyState >= 2, playing: !(video as HTMLVideoElement).paused, time: (video as HTMLVideoElement).currentTime > 0 }))).toEqual({ ready: true, playing: true, time: true })
  await expect(page.locator("video")).toHaveAttribute("aria-label", /not a live Premiere recording/)
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
  await expect(page.locator("h1")).toHaveText(/Your vision[\s\S]*timeline/)
  await expect(page.locator(`a[href="${product.downloads.claudeBundle}"]`)).toBeVisible()
  await page.locator('a[href="/docs/"]').first().click()
  await page.locator('a[href="/"]').first().click()
  await expect(page.locator("h1")).toHaveText(/Your vision[\s\S]*timeline/)
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
    expect(submitted).toEqual(["homepage_experiment_exposed"])
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
