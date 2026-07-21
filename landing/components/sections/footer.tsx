import { Github, Package } from "lucide-react"

export function Footer() {
  return (
    <footer className="bg-black px-5 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 border-b border-zinc-900 pb-10 md:grid-cols-[1fr_auto_auto] md:gap-16">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-purple-400/30 bg-purple-500/15 font-mono text-sm text-purple-200">Pr</span>
              <span className="text-sm font-semibold text-white">premiere-pro-mcp</span>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-500">Open-source, local-first AI control for Adobe Premiere Pro.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Product</p>
            <div className="mt-4 flex flex-col gap-3 text-sm text-zinc-400">
              <a href="#features" className="hover:text-white">Features</a>
              <a href="#how-it-works" className="hover:text-white">How it works</a>
              <a href="#install" className="hover:text-white">Install</a>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Resources</p>
            <div className="mt-4 flex flex-col gap-3 text-sm text-zinc-400">
              <a href="https://github.com/leancoderkavy/premiere-pro-mcp" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Github className="h-4 w-4" /> GitHub</a>
              <a href="https://www.npmjs.com/package/premiere-pro-mcp" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Package className="h-4 w-4" /> npm v1.1.6</a>
              <a href="https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer" className="hover:text-white">Security</a>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-6 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 premiere-pro-mcp contributors. MIT licensed.</p>
          <p>Not affiliated with Adobe Inc. Adobe Premiere Pro is a trademark of Adobe Inc.</p>
        </div>
      </div>
    </footer>
  )
}
