export type OnboardingEvent =
  | "onboarding_assistant_selected"
  | "onboarding_download_started"
  | "onboarding_safe_prompt_copied"
  | "onboarding_advanced_opened"
  | "onboarding_recovery_opened"
  | "marketing_cta_clicked"
  | "marketing_demo_played"

type OnboardingEventParameters = Record<string, string>

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
  if (typeof window === "undefined") return
  const safeParameters = { ...campaignParameters(), ...parameters }

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
