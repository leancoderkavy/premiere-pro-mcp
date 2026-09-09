"use client"

import { useEffect } from "react"

/** Same-origin, bounded events. The server validates the signed assignment. */
export function LandingExperiment({
  variant
}: {
  variant: "control" | "test"
}) {
  useEffect(() => {
    const privacy = navigator as Navigator & { globalPrivacyControl?: boolean }
    const permitted = () =>
      !["1", "yes"].includes(privacy.doNotTrack ?? "") &&
      !privacy.globalPrivacyControl
    if (
      window.location.pathname !== "/" ||
      new URLSearchParams(window.location.search).has("design") ||
      !permitted()
    )
      return
    let exposed: Promise<Response> | undefined
    function send(event: string, parameters: Record<string, string> = {}) {
      if (!permitted()) return Promise.reject(new Error("Analytics disabled"))
      return fetch("/api/landing-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ event, variant, parameters })
      })
    }
    function expose() {
      if (document.visibilityState !== "visible" || exposed || !permitted())
        return
      exposed = send("homepage_experiment_exposed")
      void exposed.catch(() => {})
    }
    function action(event: Event) {
      const detail = (
        event as CustomEvent<{
          eventName: string
          parameters: Record<string, string>
        }>
      ).detail
      if (!detail || !permitted()) return
      expose()
      const parameters = Object.fromEntries(
        ["route", "assistant", "location", "destination", "demo"].flatMap(
          (key) => {
            const value = detail.parameters?.[key]
            return typeof value === "string" && /^[a-z0-9_-]{1,48}$/.test(value)
              ? [[key, value]]
              : []
          }
        )
      )
      // Conversion follows a successful exposure acknowledgement, even if the
      // visitor clicks immediately or leaves through a download link.
      void exposed
        ?.then((response) =>
          response.ok ? send(detail.eventName, parameters) : undefined
        )
        .catch(() => {})
    }
    window.addEventListener("premiere-pro-mcp:onboarding", action)
    document.addEventListener("visibilitychange", expose)
    const frame = requestAnimationFrame(expose)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("premiere-pro-mcp:onboarding", action)
      document.removeEventListener("visibilitychange", expose)
    }
  }, [variant])
  return null
}
