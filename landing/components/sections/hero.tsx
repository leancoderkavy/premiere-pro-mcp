import { Github, Monitor, Package, ShieldCheck, Sparkles } from "lucide-react"
import Image from "next/image"
import { HeroDepthLoader } from "@/components/sections/hero-depth-loader"
import { MobileNav } from "@/components/sections/mobile-nav"
import { WorkflowProof } from "@/components/sections/workflow-proof"
import { TrackedLink } from "@/components/ui/tracked-link"
import { product } from "@/lib/product"

const navItems = [
  { label: "Demo", href: "#demo" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Project Intake", href: "/project-intake/" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
  { label: "Guides", href: "/blog/" },
  { label: "Docs", href: "/docs/" },
  { label: "Changelog", href: "/changelog/" },
]

const proofItems = [
  { icon: Sparkles, title: `v${product.version}`, detail: "Current release" },
  { icon: Monitor, title: "macOS + Windows", detail: "Apple Silicon + Intel" },
  { icon: ShieldCheck, title: "Local-first", detail: "Your media stays local" },
  { icon: Github, title: "MIT licensed", detail: "Open source" },
]

export function HeroSection() {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5" aria-label="Primary navigation">
          <a href="#top" className="flex items-center gap-3 text-sm font-semibold text-white">
            <Image
              src="/marketing/premiere-pro-mcp-mark-v1.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
              priority
            />
            <span>premiere-pro-mcp</span>
          </a>
          <div className="flex items-center gap-5">
            <div className="hidden items-center gap-5 lg:flex">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} className="text-sm text-zinc-400 transition-colors hover:text-white">
                  {item.label}
                </a>
              ))}
            </div>
            <MobileNav />
            <TrackedLink
              href="https://github.com/leancoderkavy/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              trackingLocation="navigation"
              trackingDestination="github"
              aria-label="premiere-pro-mcp on GitHub"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
            >
              <Github className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </TrackedLink>
          </div>
        </nav>
      </header>

      <section id="top" className="relative overflow-hidden px-5 pb-16 pt-28 md:pb-28 md:pt-44">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="hero-glow absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2" aria-hidden="true" />
        <HeroDepthLoader />
        <div className="hero-depth-vignette absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="hero-enter hero-enter-1 mb-5 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">
              Open source · local-first · reviewable workflows
            </p>
            <h1 className="hero-enter hero-enter-1 text-balance text-4xl font-bold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl md:text-7xl">
              MCP for Adobe Premiere Pro: <span className="accent-text">reviewable workflows.</span>
            </h1>
            <p className="hero-enter hero-enter-2 mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-zinc-400 md:text-xl">
              Use the MCP-compatible client your team already trusts to capture local project context, prepare a non-mutating plan, and verify supported Premiere work before you rely on it.
            </p>
            <div className="hero-enter hero-enter-3 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <TrackedLink
                href="#install"
                trackingLocation="hero"
                trackingDestination="safe_connection_check"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-purple-300 px-6 text-sm font-semibold text-black transition-colors hover:bg-white"
              >
                <Package className="h-4 w-4" /> Run a safe connection check
              </TrackedLink>
              <TrackedLink
                href="/project-intake/"
                trackingLocation="hero"
                trackingDestination="project_intake_workflow"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/80 px-6 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
              >
                <ShieldCheck className="h-4 w-4" /> See Project Intake
              </TrackedLink>
            </div>
            <p className="hero-enter hero-enter-3 mt-4 text-sm text-zinc-500">
              Project context is opt-in and local · every applied plan requires current targets and confirmation
            </p>
          </div>

          <div className="hero-enter hero-enter-4">
            <WorkflowProof />
          </div>

          <div className="hero-enter hero-enter-5 mt-6 flex snap-x overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/75 sm:mt-8 sm:grid sm:grid-cols-2 sm:overflow-hidden lg:grid-cols-4">
            {proofItems.map((item) => (
              <div key={item.title} className="flex min-w-[13rem] snap-start items-center gap-3 border-r border-zinc-800 px-5 py-4 last:border-r-0 sm:min-w-0 sm:border-b sm:even:border-l lg:border-b-0 lg:border-l first:lg:border-l-0">
                <item.icon className="h-5 w-5 shrink-0 text-purple-400" strokeWidth={1.7} />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{item.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
