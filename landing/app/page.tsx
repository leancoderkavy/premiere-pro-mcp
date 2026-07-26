import { HeroSection } from "@/components/sections/hero"
import { FeaturesSection } from "@/components/sections/features"
import { ConnectSection } from "@/components/sections/connect"
import { ArchitectureSection } from "@/components/sections/architecture"
import { Footer } from "@/components/sections/footer"
import { FaqSection, faqItems } from "@/components/sections/faq"

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://premiere-pro-mcp.com/#organization",
      name: "Premiere Pro MCP contributors",
      url: "https://premiere-pro-mcp.com/",
      logo: {
        "@type": "ImageObject",
        url: "https://premiere-pro-mcp.com/og-image.png",
        width: 1200,
        height: 630,
      },
      sameAs: [
        "https://github.com/leancoderkavy/premiere-pro-mcp",
        "https://www.npmjs.com/package/premiere-pro-mcp",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://premiere-pro-mcp.com/#website",
      name: "Premiere Pro MCP",
      url: "https://premiere-pro-mcp.com/",
      description: "Open-source AI control and automation for Adobe Premiere Pro through the Model Context Protocol.",
      inLanguage: "en-US",
      publisher: { "@id": "https://premiere-pro-mcp.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://premiere-pro-mcp.com/#software",
      name: "Premiere Pro MCP",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Windows",
      softwareVersion: "1.4.0",
      description:
        "Open-source Model Context Protocol server with 269 tools for AI-assisted editing and automation in Adobe Premiere Pro.",
      url: "https://premiere-pro-mcp.com/",
      downloadUrl: "https://www.npmjs.com/package/premiere-pro-mcp",
      codeRepository: "https://github.com/leancoderkavy/premiere-pro-mcp",
      sameAs: [
        "https://github.com/leancoderkavy/premiere-pro-mcp",
        "https://www.npmjs.com/package/premiere-pro-mcp",
      ],
      releaseNotes: "https://github.com/leancoderkavy/premiere-pro-mcp/releases",
      softwareRequirements: "Node.js 20.19 or newer and Adobe Premiere Pro 2020–2026",
      author: { "@id": "https://premiere-pro-mcp.com/#organization" },
      publisher: { "@id": "https://premiere-pro-mcp.com/#organization" },
      image: "https://premiere-pro-mcp.com/og-image.png",
      dateModified: "2026-07-26",
      featureList: [
        "Timeline editing",
        "Effects and Lumetri color control",
        "Keyframe automation",
        "Media and project management",
        "Adobe Media Encoder export",
        "Custom ExtendScript and QE DOM workflows",
      ],
      license: "https://opensource.org/license/mit",
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    {
      "@type": "FAQPage",
      "@id": "https://premiere-pro-mcp.com/#faq",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main className="min-h-screen overflow-x-hidden bg-black text-white">
        <HeroSection />
        <FeaturesSection />
        <ConnectSection />
        <ArchitectureSection />
        <FaqSection />
        <Footer />
      </main>
    </>
  )
}
