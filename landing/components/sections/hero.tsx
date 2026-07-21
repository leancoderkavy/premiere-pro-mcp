import { ArrowRight, Github, Monitor, Package, ShieldCheck, Sparkles } from "lucide-react"

const navItems = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Install", href: "#install" },
  { label: "FAQ", href: "#faq" },
]

const proofItems = [
  { icon: Sparkles, title: "Premiere Pro", detail: "2020–2026" },
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
            <span className="grid h-8 w-8 place-items-center rounded-md border border-purple-400/30 bg-purple-500/15 font-mono text-sm text-purple-200">
              Pr
            </span>
            <span>premiere-pro-mcp</span>
          </a>
          <div className="hidden items-center gap-7 md:flex">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="text-sm text-zinc-400 transition-colors hover:text-white">
                {item.label}
              </a>
            ))}
            <a
              href="https://github.com/leancoderkavy/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
            >
              GitHub <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </nav>
      </header>

      <section id="top" className="relative overflow-hidden px-5 pb-20 pt-36 md:pb-28 md:pt-44">
        <div className="hero-grid absolute inset-0" aria-hidden="true" />
        <div className="hero-glow absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="hero-enter hero-enter-1 text-balance text-5xl font-bold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl md:text-7xl">
              Control Adobe Premiere Pro with <span className="accent-text">AI</span>
            </h1>
            <p className="hero-enter hero-enter-2 mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-zinc-400 md:text-xl">
              An open-source MCP server with 269 tools for timeline editing, effects, color, keyframes, media management, and export.
            </p>
            <div className="hero-enter hero-enter-3 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#install"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#8b7cff] to-[#ef76b9] px-6 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(139,124,255,0.22)] transition-transform hover:-translate-y-0.5"
              >
                <Package className="h-4 w-4" /> Install from npm
              </a>
              <a
                href="https://github.com/leancoderkavy/premiere-pro-mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950/80 px-6 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900"
              >
                <Github className="h-4 w-4" /> View on GitHub
              </a>
            </div>
          </div>

          <div className="hero-enter hero-enter-4 terminal-float mx-auto mt-14 max-w-3xl overflow-hidden rounded-xl border border-zinc-800 bg-[#08080a] shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-center border-b border-zinc-800 px-4 py-3">
              <div className="flex gap-2" aria-hidden="true">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="status-pulse h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="ml-4 font-mono text-xs text-zinc-500">premiere-pro-mcp</span>
              <span className="ml-auto h-5 w-10 bg-gradient-to-r from-[#8b7cff] to-[#ef76b9]" aria-hidden="true" />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-7 sm:p-7 sm:text-sm">
              <code>
                <span className="text-zinc-600">$ </span><span className="text-emerald-400">npm install -g premiere-pro-mcp</span>{"\n"}
                <span className="text-zinc-600">$ </span><span className="text-emerald-400">premiere-pro-mcp --install-cep</span>{"\n\n"}
                <span className="text-zinc-500"># Ask your MCP client</span>{"\n"}
                <span className="text-zinc-100">“Add B-roll to V2, match the grade, then export 1080p ProRes.”</span>{"\n\n"}
                <span className="text-purple-300">✓ 269 tools registered · bridge ready</span>
              </code>
            </pre>
          </div>

          <div className="hero-enter hero-enter-5 mt-8 grid overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/75 sm:grid-cols-2 lg:grid-cols-4">
            {proofItems.map((item) => (
              <div key={item.title} className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4 last:border-b-0 sm:even:border-l lg:border-b-0 lg:border-l first:lg:border-l-0">
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
