export type OnboardingEvent =
  | "marketing_viewed"
  | "primary_cta_clicked"
  | "onboarding_assistant_selected"
  | "onboarding_download_started"
  | "onboarding_safe_prompt_copied"
  | "onboarding_advanced_opened"
  | "onboarding_recovery_opened"
  | "marketing_demo_played"

type OnboardingEventParameters = Record<string, string>

const firstTouchStorageKey = "premiere-pro-mcp:first-touch"

const campaignParameterNames = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const

function campaignParameters(): OnboardingEventParameters {
  if (typeof window === "undefined") return {}
  const values: OnboardingEventParameters = {}
  const search = new URLSearchParams(window.location.search)
  for (const name of campaignParameterNames) {
    const value = search.get(name)
    if (value && value.length <= 80 && /^[a-z0-9._~-]+$/i.test(value)) values[name] = value
  }
  return values
}

function sessionCampaignParameters(key: string): OnboardingEventParameters {
  if (typeof window === "undefined") return {}
  try {
    const stored = window.sessionStorage.getItem(key)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      campaignParameterNames.flatMap((name) => {
        const value = (parsed as Record<string, unknown>)[name]
        return typeof value === "string" && value.length <= 80 && /^[a-z0-9._~-]+$/i.test(value)
          ? [[name, value]]
          : []
      }),
    )
  } catch {
    return {}
  }
}

function attributionParameters(): OnboardingEventParameters {
  const latestTouch = campaignParameters()
  let firstTouch = sessionCampaignParameters(firstTouchStorageKey)

  if (!Object.keys(firstTouch).length && Object.keys(latestTouch).length) {
    firstTouch = latestTouch
    try {
      window.sessionStorage.setItem(firstTouchStorageKey, JSON.stringify(firstTouch))
    } catch {
      // Private browsing and restrictive browser settings can disable storage.
      // Analytics remains optional, so continue without durable attribution.
    }
  }

  return {
    ...firstTouch,
    ...Object.fromEntries(Object.entries(latestTouch).map(([name, value]) => [`latest_${name}`, value])),
  }
}

function analyticsPermitted() {
  if (typeof window === "undefined") return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return !["1", "yes"].includes(nav.doNotTrack ?? "") && !nav.globalPrivacyControl
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

/**
 * Records only route and action names. Prompts, project details, media names,
 * file paths, and other editor content must never be passed to this helper.
 */
export function trackOnboardingEvent(
  eventName: OnboardingEvent,
  parameters: OnboardingEventParameters = {},
) {
  if (!analyticsPermitted()) return
  const safeParameters = {
    product: "premiere-pro-mcp",
    event: eventName,
    occurred_at: new Date().toISOString(),
    path: window.location.pathname,
    ...attributionParameters(),
    ...parameters,
  }

  window.dispatchEvent(
    new CustomEvent("premiere-pro-mcp:onboarding", {
      detail: { eventName, parameters: safeParameters },
    }),
  )
  // The external analytics loader is intentionally deferred. Keep a tiny local
  // queue so a first CTA is retained without placing inline executable code in
  // the document or forcing a third-party script into the critical path.
  window.dataLayer = window.dataLayer ?? []
  window.gtag = window.gtag ?? ((...args: unknown[]) => {
    window.dataLayer?.push(args)
  })
  window.gtag("event", eventName, safeParameters)
}
