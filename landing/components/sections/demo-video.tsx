import { Clapperboard, Film, WandSparkles } from "lucide-react"

const outcomes = [
  { icon: Film, label: "Timeline", detail: "B-roll inserted on V2" },
  { icon: WandSparkles, label: "Finish", detail: "Grade and title applied" },
  { icon: Clapperboard, label: "Delivery", detail: "ProRes export queued" },
]

export function DemoVideoSection() {
  return (
    <section id="demo" className="reveal-section overflow-hidden border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">One request. A finished sequence.</p>
            <h2 className="mt-4 text-balance text-4xl font-bold tracking-[-0.035em] text-white md:text-6xl">
              See the edit happen.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-zinc-400 md:text-right">
            The AI chooses structured tools. Premiere executes every change locally. You keep control of the project.
          </p>
        </div>

        <div className="demo-video-shell relative mt-14 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_38px_100px_rgba(0,0,0,0.58)]">
          <video
            className="aspect-video w-full bg-[#060608]"
            controls
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/premiere-pro-mcp-demo-poster.png"
            aria-label="Premiere Pro MCP inserts B-roll, applies a color grade and title, then queues a ProRes export"
          >
            <source src="/premiere-pro-mcp-demo.mp4" type="video/mp4" />
            Your browser does not support embedded video. The demo shows an AI request becoming a structured Premiere Pro edit.
          </video>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-300/60 to-transparent" aria-hidden="true" />
        </div>

        <div className="mt-8 grid border-t border-zinc-800 sm:grid-cols-3">
          {outcomes.map((outcome) => (
            <div key={outcome.label} className="flex items-center gap-4 border-b border-zinc-800 py-5 sm:border-b-0 sm:border-r sm:px-6 first:sm:pl-0 last:sm:border-r-0">
              <outcome.icon className="h-5 w-5 shrink-0 text-purple-300" strokeWidth={1.6} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{outcome.label}</p>
                <p className="mt-1 text-sm text-zinc-200">{outcome.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
