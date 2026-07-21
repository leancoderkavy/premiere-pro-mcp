import { HeroSection } from "@/components/sections/hero"
import { FeaturesSection } from "@/components/sections/features"
import { ConnectSection } from "@/components/sections/connect"
import { ArchitectureSection } from "@/components/sections/architecture"
import { Footer } from "@/components/sections/footer"

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Premiere Pro MCP",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Windows",
  softwareVersion: "1.1.7",
  description:
    "Open-source Model Context Protocol server for AI-assisted editing and automation in Adobe Premiere Pro.",
  url: "https://premiere-pro-mcp.fly.dev/",
  downloadUrl: "https://www.npmjs.com/package/premiere-pro-mcp",
  codeRepository: "https://github.com/leancoderkavy/premiere-pro-mcp",
  license: "https://opensource.org/license/mit",
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <main className="min-h-screen overflow-x-hidden bg-black text-white">
        <HeroSection />
        <FeaturesSection />
        <ConnectSection />
        <ArchitectureSection />
        <Footer />
      </main>
    </>
  )
}
