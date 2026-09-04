import { Code2, FolderOpen, KeyRound, Scissors, SlidersHorizontal, Upload } from "lucide-react"

const capabilities = [
  {
    icon: Scissors,
    title: "Edit timelines with intent",
    description: "Insert, overwrite, trim, split, move, ripple-delete, roll, slide, and slip across sequences and tracks.",
  },
  {
    icon: SlidersHorizontal,
    title: "Apply repeatable finishing work",
    description: "Apply effects, adjust Lumetri parameters, load LUTs, stabilize clips, and automate repetitive grading steps.",
  },
  {
    icon: KeyRound,
    title: "Control keyframes and motion",
    description: "Add, update, and inspect keyframes with interpolation controls for repeatable animation work.",
  },
  {
    icon: FolderOpen,
    title: "Organize project structure",
    description: "Import footage, manage bins, create sequences from presets, inspect metadata, and work with proxies.",
  },
  {
    icon: Upload,
    title: "Prepare exports with explicit settings",
    description: "Queue sequences and project items through Adobe Media Encoder using the presets you choose.",
  },
  {
    icon: Code2,
    title: "Use documented extension seams",
    description: "Use the structured MCP surface or run custom ExtendScript and QE DOM workflows when you need deeper control.",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="reveal-section border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
            A narrower interface for <span className="text-violet-300">predictable edit work.</span>
          </h2>
          <p className="mt-5 text-lg leading-8 text-zinc-400">
            Give an MCP-compatible client structured operations instead of asking it to infer state from Premiere&apos;s interface.
          </p>
        </div>

        <div className="mt-16 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability) => (
            <article key={capability.title} className="group border-t border-zinc-800 pt-6">
              <capability.icon className="h-6 w-6 text-violet-300 transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transform-none" strokeWidth={1.6} />
              <h3 className="mt-6 text-lg font-semibold text-zinc-100">{capability.title}</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-400">{capability.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
