import type { ReactNode } from "react"
import { SiteHeader } from "./site-header"
import { Footer } from "@/components/sections/footer"

/** Shared shell for public resources; page content and SEO stay server rendered. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="public-site">
      <SiteHeader />
      <div className="public-content">{children}</div>
      <Footer />
    </div>
  )
}
