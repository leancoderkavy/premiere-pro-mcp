"use client"

import type { ComponentPropsWithoutRef } from "react"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

type TrackedLinkProps = ComponentPropsWithoutRef<"a"> & {
  trackingLocation: string
  trackingDestination: string
}

export function TrackedLink({
  trackingLocation,
  trackingDestination,
  onClick,
  ...props
}: TrackedLinkProps) {
  return (
    <a
      {...props}
      onClick={(event) => {
        trackOnboardingEvent("marketing_cta_clicked", {
          location: trackingLocation,
          destination: trackingDestination,
        })
        onClick?.(event)
      }}
    />
  )
}
