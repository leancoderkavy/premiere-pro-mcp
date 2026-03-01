import { BorderBeam } from "@/components/ui/border-beam"
import {
  Film, Sliders, Wand2, Code2, Layers, Cpu,
} from "lucide-react"

const features = [
  {
    icon: Film,
    title: "Full Timeline Control",
    description:
      "Insert, overwrite, trim, split, move, and ripple-delete clips. Roll, slide, and slip edits via QE DOM for professional-grade trimming.",
    color: "from-blue-500/20 to-blue-600/5",
    border: "#3b82f6",
  },
  {
    icon: Sliders,
    title: "Effects & Color Grading",
    description:
      "Apply any effect by name, set Lumetri Color parameters, load LUTs, run Warp Stabilizer, and manage keyframes with bezier interpolation.",
    color: "from-purple-500/20 to-purple-600/5",
    border: "#a855f7",
  },
  {
    icon: Wand2,
    title: "AI-Driven Workflows",
    description:
      "Describe your edit in plain language. The AI plans the workflow, calls the right tools in order, and handles error recovery automatically.",
    color: "from-pink-500/20 to-pink-600/5",
    border: "#ec4899",
  },
  {
    icon: Code2,
    title: "Custom ExtendScript",
    description:
      "Run any ExtendScript or QE DOM code on demand. The AI can write scripts to handle tasks beyond the built-in 269 tools.",
    color: "from-teal-500/20 to-teal-600/5",
    border: "#14b8a6",
  },
  {
    icon: Layers,
    title: "Project & Media Management",
    description:
      "Import media, manage bins, create sequences, reframe for social, consolidate projects, and batch-encode with Adobe Media Encoder.",
    color: "from-orange-500/20 to-orange-600/5",
    border: "#f97316",
  },
  {
    icon: Cpu,
    title: "File-Bridge Architecture",
    description:
      "No network sockets. Commands flow via a shared temp directory — simple, reliable, and battle-tested across macOS and Windows.",
    color: "from-green-500/20 to-green-600/5",
    border: "#22c55e",
  },
]

export function FeaturesSection() {
  return (
    <section className="bg-black px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Capabilities</p>
          <h2 className="mt-2 text-3xl font-bold text-white md:text-4xl">
            Professional editing, fully automated
          </h2>
          <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
            Every major Premiere Pro workflow is accessible via structured MCP tools with full error handling and result feedback.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-6 transition-all duration-300 hover:border-zinc-600 hover:-translate-y-1"
            >
              <BorderBeam colorFrom={f.border} colorTo={f.border + "88"} duration={10} size={80} />
              <div className={`mb-4 inline-flex rounded-lg bg-gradient-to-br ${f.color} p-2.5`}>
                <f.icon className="h-5 w-5 text-white" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-zinc-400">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
