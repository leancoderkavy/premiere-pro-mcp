import { HeroSection } from "@/components/sections/hero"
import { FeaturesSection } from "@/components/sections/features"
import { ToolsMarquee } from "@/components/sections/tools-marquee"
import { ConnectSection } from "@/components/sections/connect"
import { ArchitectureSection } from "@/components/sections/architecture"
import { InstallSection } from "@/components/sections/install"
import { Footer } from "@/components/sections/footer"

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white overflow-x-hidden">
      <HeroSection />
      <ToolsMarquee />
      <FeaturesSection />
      <ConnectSection />
      <ArchitectureSection />
      <InstallSection />
      <Footer />
    </main>
  )
}
