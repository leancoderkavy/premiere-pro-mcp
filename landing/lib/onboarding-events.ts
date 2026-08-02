export type OnboardingEvent =
  | "onboarding_assistant_selected"
  | "onboarding_download_started"
  | "onboarding_safe_prompt_copied"
  | "onboarding_advanced_opened"
  | "onboarding_recovery_opened"

type OnboardingEventParameters = Record<string, string>

declare global {
  interface Window {
    gtag?: (command: "event", eventName: string, parameters?: OnboardingEventParameters) => void
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

  window.dispatchEvent(
    new CustomEvent("premiere-pro-mcp:onboarding", {
      detail: { eventName, parameters },
    }),
  )
  window.gtag?.("event", eventName, parameters)
}
