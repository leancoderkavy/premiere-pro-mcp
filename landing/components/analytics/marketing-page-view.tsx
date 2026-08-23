"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

/**
 * Records bounded, anonymous page views for acquisition measurement. It sends
 * no prompt, project, media, identity, or file-path data and respects DNT/GPC.
 */
export function MarketingPageView() {
  const pathname = usePathname()
  const lastTrackedPath = useRef<string | null>(null)

  useEffect(() => {
    if (lastTrackedPath.current === pathname) return
    lastTrackedPath.current = pathname
    trackOnboardingEvent("marketing_viewed")
  }, [pathname])

  return null
}
