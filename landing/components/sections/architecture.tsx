import { AlertTriangle, ArrowDown, CheckCircle2, FileCode2, PlugZap, TerminalSquare } from "lucide-react"

const bridgeSteps = [
  {
    icon: TerminalSquare,
    title: "Your AI calls a tool",
    description: "Claude, Cursor, Windsurf, or another MCP client sends a structured request to the local server.",
  },
  {
    icon: FileCode2,
    title: "The bridge runs it in Premiere",
    description: "A versioned helper library and small ES3 script pass through a private shared temp directory.",
  },
  {
    icon: PlugZap,
    title: "Premiere returns a result",
    description: "The CEP bridge executes the command and sends structured data, confirmation, or diagnostics back to the client.",
  },
]

const diagnostics = [
  {
    icon: CheckCircle2,
    title: "Automatic bridge startup",
    description: "The CEP bridge creates its temp directory and starts polling when Premiere activates.",
  },
  {
    icon: AlertTriangle,
    title: "Modal-stall diagnostics",
    description: "In-flight heartbeats help distinguish an open Premiere dialog from a disconnected bridge.",
  },
]

export function ArchitectureSection() {
  return (
    <section id="how-it-works" className="border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">How the bridge <span className="text-purple-400">works</span></h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
              A local-first file bridge keeps the control path inspectable and avoids exposing your project media to the MCP server.
            </p>
            <div className="mt-10">
              {bridgeSteps.map((step, index) => (
                <div key={step.title} className="relative flex gap-5 pb-9 last:pb-0">
                  {index < bridgeSteps.length - 1 && <span className="absolute left-[19px] top-10 h-[calc(100%-2rem)] w-px bg-zinc-800" aria-hidden="true" />}
                  <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-purple-400">
                    <step.icon className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Compatibility &amp; <span className="text-purple-400">diagnostics</span></h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
              Current releases target Premiere Pro 2020–2026 on macOS and Windows, with clearer failure states for the issues users hit most often.
            </p>
            <div className="mt-10 space-y-4">
              {diagnostics.map((item) => (
                <article key={item.title} className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                  <item.icon className="mt-0.5 h-6 w-6 shrink-0 text-purple-300" strokeWidth={1.5} />
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
              <p className="text-sm leading-6 text-zinc-400">
                <span className="font-semibold text-amber-200">Know the boundary:</span> Premiere’s undocumented QE DOM is powerful but imperfect. Frame export and Media Encoder queue status have API limitations; the server reports diagnostics instead of claiming success without a file.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-4 rounded-xl border border-zinc-800 bg-black px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-200">Need the full tool list, schemas, or troubleshooting guide?</p>
            <p className="mt-1 text-sm text-zinc-500">The README documents every setup path and known security boundary.</p>
          </div>
          <a
            href="https://github.com/leancoderkavy/premiere-pro-mcp#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-purple-300 transition-colors hover:text-purple-200"
          >
            Read the documentation <ArrowDown className="h-4 w-4 -rotate-90" />
          </a>
        </div>
      </div>
    </section>
  )
}
