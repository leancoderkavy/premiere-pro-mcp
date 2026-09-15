import Image from "next/image"
import { HomeLink } from "@/components/ui/home-link"
import { siteNavigation } from "@/lib/site-navigation"
import { product } from "@/lib/product"

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-intro">
          <HomeLink className="site-brand" aria-label="Premiere Pro MCP home">
            <Image src="/marketing/premiere-pro-mcp-mark-v2.svg" width={28} height={28} alt="" />
            <span>premiere<span className="site-brand-divider">/</span>mcp</span>
          </HomeLink>
          <p>Connect your AI assistant to Premiere Pro.<br />Free, open source, and locally installed.</p>
        </div>
        <nav className="site-footer-links" aria-label="Footer navigation">
          {siteNavigation.map(group => (
            <div key={group.label}>
              <h2>{group.label}</h2>
              {group.links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}
            </div>
          ))}
          <div>
            <h2>Open source</h2>
            <a href={product.links.repository}>GitHub</a>
            <a href={product.links.npm}>npm package</a>
            <a href={product.links.issues}>Report an issue</a>
            <a href={product.links.repository + "/security/policy"}>Security</a>
            <a href="/privacy/">Privacy</a>
          </div>
        </nav>
        <div className="site-footer-bottom">
          <p>© 2026 Premiere Pro MCP contributors. MIT licensed.</p>
          <p>Independent open-source project. Not affiliated with Adobe Inc.<br />Adobe Premiere Pro is a trademark of Adobe Inc.</p>
        </div>
      </div>
    </footer>
  )
}
