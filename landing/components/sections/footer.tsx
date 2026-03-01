import { Github, Package } from "lucide-react"

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">premiere-pro-mcp</span>
              <span className="rounded bg-purple-900/60 px-2 py-0.5 text-xs text-purple-300">v1.1.0</span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              The most complete MCP server for Adobe Premiere Pro.
            </p>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="https://github.com/leancoderkavy/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <Package className="h-4 w-4" />
              npm
            </a>
            <a
              href="https://premiere-pro-mcp.fly.dev/mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              MCP Endpoint
            </a>
            <a
              href="https://premiere-pro-mcp.fly.dev/health"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              Health
            </a>
          </div>
        </div>

        <div className="mt-8 border-t border-zinc-900 pt-6 text-center text-xs text-zinc-600">
          MIT License &bull; Not affiliated with Adobe Inc. &bull; Adobe Premiere Pro is a trademark of Adobe Inc.
        </div>
      </div>
    </footer>
  )
}
