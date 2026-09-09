import { HeroSection } from "@/components/sections/hero"
import { FeaturesSection } from "@/components/sections/features"
import { ConnectSection } from "@/components/sections/connect"
import { ArchitectureSection } from "@/components/sections/architecture"
import { Footer } from "@/components/sections/footer"
import { FaqSection } from "@/components/sections/faq"
import { DemoVideoSection } from "@/components/sections/demo-video"
import { FinalCtaSection } from "@/components/sections/final-cta"
import { HomeStructuredData } from "@/components/analytics/home-structured-data"
import { LandingExperiment } from "@/components/analytics/landing-experiment"

export default function Home() {
  return (
    <>
      <LandingExperiment variant="control" />
      <HomeStructuredData />
      <main id="main-content" className="min-h-screen overflow-x-hidden bg-black text-white">
        <HeroSection />
        <DemoVideoSection />
        <FeaturesSection />
        <ConnectSection />
        <ArchitectureSection />
        <FaqSection />
        <FinalCtaSection />
        <Footer />
      </main>
    </>
  )
}
