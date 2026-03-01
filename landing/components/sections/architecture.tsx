import { BorderBeam } from "@/components/ui/border-beam"

const steps = [
  {
    n: "01",
    title: "AI invokes a tool",
    desc: 'Claude (or any MCP client) calls e.g. "add_to_timeline" with parameters.',
    color: "#9999ff",
  },
  {
    n: "02",
    title: "ExtendScript is generated",
    desc: "The MCP server builds ES3-compatible ExtendScript with helper functions prepended.",
    color: "#ff6699",
  },
  {
    n: "03",
    title: "Script written to temp dir",
    desc: "A .jsx command file is dropped into the shared temp directory (configurable via PREMIERE_TEMP_DIR).",
    color: "#ffaa40",
  },
  {
    n: "04",
    title: "CEP plugin executes it",
    desc: "The Premiere Pro panel polls for new .jsx files and runs them via CSInterface.evalScript().",
    color: "#40ffaa",
  },
  {
    n: "05",
    title: "Result returned as JSON",
    desc: "The CEP plugin writes a .json response; the MCP server polls for it and returns it to the AI.",
    color: "#40aaff",
  },
]

export function ArchitectureSection() {
  return (
    <section className="bg-zinc-950 px-4 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">How it works</p>
          <h2 className="mt-2 text-3xl font-bold text-white md:text-4xl">File-bridge architecture</h2>
          <p className="mt-4 mx-auto max-w-xl text-zinc-400">
            No network daemons, no native extensions. A battle-tested temp-directory IPC pattern that works reliably on macOS and Windows.
          </p>
        </div>

        {/* Flow diagram */}
        <div className="mb-16 overflow-hidden rounded-xl border border-zinc-800 bg-black p-6 font-mono text-sm">
          <BorderBeam colorFrom="#9999ff" colorTo="#ff6699" duration={12} />
          <div className="space-y-0 text-zinc-400 leading-relaxed">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-zinc-900 px-2 py-1 text-purple-400">AI Client</span>
              <span className="text-zinc-600">─── MCP (stdio / HTTP+SSE) ──▶</span>
              <span className="rounded bg-zinc-900 px-2 py-1 text-blue-400">MCP Server</span>
              <span className="text-zinc-600">─── .jsx file ──▶</span>
              <span className="rounded bg-zinc-900 px-2 py-1 text-pink-400">Temp Dir</span>
            </div>
            <div className="pl-8 text-zinc-600">▲ JSON result &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼ .jsx picked up</div>
            <div className="flex flex-wrap items-center gap-2 pl-8">
              <span className="rounded bg-zinc-900 px-2 py-1 text-green-400">Premiere Pro</span>
              <span className="text-zinc-600">◀─── evalScript() ───</span>
              <span className="rounded bg-zinc-900 px-2 py-1 text-orange-400">CEP Plugin</span>
              <span className="text-zinc-600">─── .json result ──▶</span>
              <span className="rounded bg-zinc-900 px-2 py-1 text-pink-400">Temp Dir</span>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="grid gap-4 md:grid-cols-5">
          {steps.map((s) => (
            <div key={s.n} className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black p-5">
              <div className="mb-3 text-3xl font-black" style={{ color: s.color }}>{s.n}</div>
              <h3 className="mb-2 text-sm font-semibold text-white">{s.title}</h3>
              <p className="text-xs leading-relaxed text-zinc-500">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Remote note */}
        <div className="mt-8 rounded-xl border border-purple-900/50 bg-purple-950/20 p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-2 w-2 rounded-full bg-purple-400 shrink-0 mt-1" />
            <div>
              <p className="text-sm font-semibold text-purple-300">Remote mode available</p>
              <p className="mt-1 text-sm text-zinc-400">
                The server also ships an <span className="text-white font-mono text-xs">HTTP/SSE transport</span> deployed at{" "}
                <a href="https://premiere-pro-mcp.fly.dev" target="_blank" rel="noopener noreferrer" className="text-purple-400 underline hover:text-purple-300">
                  premiere-pro-mcp.fly.dev
                </a>
                . Connect any MCP client via <span className="font-mono text-xs text-white">mcp-remote</span> — the MCP endpoint and CEP plugin still communicate through the shared temp directory.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
