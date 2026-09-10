import type { Metadata } from "next"
import { StudioHome } from "@/components/studio/studio-home"
import { LandingExperiment } from "@/components/analytics/landing-experiment"
import { HomeStructuredData } from "@/components/analytics/home-structured-data"

export const metadata: Metadata = {
  title: { absolute: "Your vision. In the timeline. | Premiere Pro MCP" },
  description:
    "Connect your AI assistant to Adobe Premiere Pro for structured, reviewable editing workflows. Free, open source, and local first.",
  // Both assignments hydrate this document. Preview exclusion belongs in the
  // Node server's X-Robots-Tag header, so hydration cannot noindex a live root.
  alternates: { canonical: "https://premiere-pro-mcp.com/" }
}

export default function DesignPreview() {
  return (
    <>
      <HomeStructuredData />
      <LandingExperiment variant="test" />
      <StudioHome />
    </>
  )
}
