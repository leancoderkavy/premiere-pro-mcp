import type { ReactNode } from "react"
import Image from "next/image"
import { HomeLink } from "@/components/ui/home-link"
import { TrackedLink } from "@/components/ui/tracked-link"
import { SiteNavigation } from "./site-navigation"

export function SiteHeader({ homepage = false, actions }: { homepage?: boolean; actions?: ReactNode }) {
  return (
    <header className="site-header">
      <nav className="site-container site-navigation" aria-label="Primary navigation">
        <HomeLink className="site-brand" aria-label="Premiere Pro MCP home">
          <Image src="/marketing/premiere-pro-mcp-mark-v2.svg" width={28} height={28} alt="" />
          <span>premiere<span className="site-brand-divider">/</span>mcp</span>
        </HomeLink>
        <SiteNavigation homepage={homepage} />
        <div className="site-nav-actions">
          {actions}
          <TrackedLink href={homepage ? "#install" : "/#install"} trackingLocation="navigation" trackingDestination="safe_connection_check" className="site-connect">Get connected</TrackedLink>
        </div>
      </nav>
    </header>
  )
}
