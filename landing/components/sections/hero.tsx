import { Github, Monitor, Package, ShieldCheck } from "lucide-react"
import Image from "next/image"
import { MobileNav } from "@/components/sections/mobile-nav"
import { WorkflowProof } from "@/components/sections/workflow-proof"
import { TrackedLink } from "@/components/ui/tracked-link"
import { product } from "@/lib/product"

const navItems = [
  { label: "Demo", href: "#demo" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Workflows", href: "/workflows/" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
  { label: "Guides", href: "/blog/" },
  { label: "Docs", href: "/docs/" },
  { label: "Changelog", href: "/changelog/" },
]

const proofItems = [
  { icon: Package, title: `v${product.version}`, detail: "Current release" },
  { icon: Monitor, title: "macOS + Windows", detail: "Supported desktop hosts" },
  { icon: ShieldCheck, title: "Local-first", detail: "Media stays on your machine" },
  { icon: Github, title: "MIT licensed", detail: "Source available on GitHub" },
]

export function HeroSection() {
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/95">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-5" aria-label="Primary navigation">
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
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
            >
              <Github className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </TrackedLink>
          </div>
        </nav>
      </header>

      <section id="top" className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-5 md:pb-28 md:pt-40">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="hero-glow absolute left-1/2 top-0 h-[30rem] w-full max-w-[52rem] -translate-x-1/2" aria-hidden="true" />
        <div className="hero-timeline absolute inset-x-0 top-24 mx-auto hidden max-w-5xl md:block" aria-hidden="true">
          <span className="timeline-rule timeline-rule-one" />
          <span className="timeline-rule timeline-rule-two" />
          <span className="timeline-clip timeline-clip-one" />
          <span className="timeline-clip timeline-clip-two" />
          <span className="timeline-clip timeline-clip-three" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="hero-enter hero-enter-1 mb-5 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
              Open source · local bridge · explicit confirmation
            </p>
            <h1 className="hero-enter hero-enter-1 text-balance text-4xl font-bold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl md:text-7xl">
              MCP for Adobe Premiere Pro: make Premiere changes you can <span className="accent-text">inspect before you apply.</span>
            </h1>
            <p className="hero-enter hero-enter-2 mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-zinc-400 md:text-xl">
              Connect the MCP-compatible client you already use to a local Premiere bridge. Review the target and plan first, then confirm supported work with current project state.
            </p>
            <div className="hero-enter hero-enter-3 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <TrackedLink
                href="#install"
                trackingLocation="hero"
                trackingDestination="safe_connection_check"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-violet-200 px-6 text-sm font-semibold text-black transition-colors hover:bg-white"
              >
                <Package className="h-4 w-4" /> Verify your connection
              </TrackedLink>
              <TrackedLink
                href="/workflows/"
                trackingLocation="hero"
                trackingDestination="workflow_starter_kit"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-950/80 px-6 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
              >
                <ShieldCheck className="h-4 w-4" /> Try a workflow
              </TrackedLink>
            </div>
            <p className="hero-enter hero-enter-3 mt-4 text-sm text-zinc-500">
              Project context is opt-in and local. Applied plans require current targets and confirmation.
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
