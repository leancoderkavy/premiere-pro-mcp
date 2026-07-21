import { Code2, FolderOpen, KeyRound, Scissors, SlidersHorizontal, Upload } from "lucide-react"

const capabilities = [
  {
    icon: Scissors,
    title: "Edit timelines with precision",
    description: "Insert, overwrite, trim, split, move, ripple-delete, roll, slide, and slip across sequences and tracks.",
  },
  {
    icon: SlidersHorizontal,
    title: "Run effects and color workflows",
    description: "Apply effects, adjust Lumetri parameters, load LUTs, stabilize clips, and automate repetitive grading steps.",
  },
  {
    icon: KeyRound,
    title: "Control keyframes and motion",
    description: "Add, update, and inspect keyframes with interpolation controls for repeatable animation work.",
  },
  {
    icon: FolderOpen,
    title: "Organize projects and media",
    description: "Import footage, manage bins, create sequences from presets, inspect metadata, and work with proxies.",
  },
  {
    icon: Upload,
    title: "Export with explicit control",
    description: "Queue sequences and project items through Adobe Media Encoder using the presets you choose.",
  },
  {
    icon: Code2,
    title: "Extend beyond built-in tools",
    description: "Use the structured MCP surface or run custom ExtendScript and QE DOM workflows when you need deeper control.",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
            Everything you need. <span className="text-purple-400">Nothing you don’t.</span>
          </h2>
          <p className="mt-5 text-lg leading-8 text-zinc-400">
            Give an MCP-compatible AI a structured editing surface instead of asking it to guess at Premiere’s interface.
          </p>
        </div>

        <div className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => (
            <article key={capability.title} className="group border-t border-zinc-800 pt-6">
              <capability.icon className="h-6 w-6 text-purple-400 transition-transform group-hover:-translate-y-0.5" strokeWidth={1.6} />
              <h3 className="mt-6 text-lg font-semibold text-zinc-100">{capability.title}</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-500">{capability.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
