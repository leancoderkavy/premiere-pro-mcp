import { Marquee } from "@/components/ui/marquee"
import { cn } from "@/lib/utils"

const tools = [
  { name: "add_to_timeline", category: "Timeline" },
  { name: "apply_effect", category: "Effects" },
  { name: "color_correct", category: "Color" },
  { name: "export_sequence", category: "Export" },
  { name: "add_keyframe", category: "Keyframes" },
  { name: "create_sequence", category: "Sequence" },
  { name: "import_media", category: "Project" },
  { name: "ripple_delete", category: "Advanced" },
  { name: "roll_edit", category: "Advanced" },
  { name: "apply_lut", category: "Color" },
  { name: "capture_frame", category: "Export" },
  { name: "stabilize_clip", category: "Effects" },
  { name: "execute_extendscript", category: "Scripting" },
  { name: "get_project_info", category: "Discovery" },
  { name: "set_clip_properties", category: "Timeline" },
  { name: "auto_reframe_sequence", category: "Sequence" },
  { name: "copy_effects_between_clips", category: "Clipboard" },
  { name: "set_keyframe_interpolation", category: "Keyframes" },
  { name: "get_active_sequence", category: "Discovery" },
  { name: "create_caption_track", category: "Captions" },
  { name: "export_aaf", category: "Export" },
  { name: "split_clip", category: "Timeline" },
  { name: "set_workspace", category: "Workspace" },
  { name: "get_premiere_state", category: "Inspection" },
]

const categoryColors: Record<string, string> = {
  Timeline:  "text-blue-400 bg-blue-400/10",
  Effects:   "text-purple-400 bg-purple-400/10",
  Color:     "text-pink-400 bg-pink-400/10",
  Export:    "text-green-400 bg-green-400/10",
  Keyframes: "text-orange-400 bg-orange-400/10",
  Sequence:  "text-cyan-400 bg-cyan-400/10",
  Project:   "text-yellow-400 bg-yellow-400/10",
  Advanced:  "text-red-400 bg-red-400/10",
  Scripting: "text-teal-400 bg-teal-400/10",
  Discovery: "text-indigo-400 bg-indigo-400/10",
  Clipboard: "text-violet-400 bg-violet-400/10",
  Captions:  "text-lime-400 bg-lime-400/10",
  Workspace: "text-amber-400 bg-amber-400/10",
  Inspection:"text-sky-400 bg-sky-400/10",
}

function ToolCard({ name, category }: { name: string; category: string }) {
  const color = categoryColors[category] ?? "text-zinc-400 bg-zinc-400/10"
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 shadow-sm">
      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", color)}>
        {category}
      </span>
      <code className="text-sm text-zinc-300">{name}</code>
    </div>
  )
}

const half = Math.ceil(tools.length / 2)
const row1 = tools.slice(0, half)
const row2 = tools.slice(half)

export function ToolsMarquee() {
  return (
    <section className="relative overflow-hidden bg-black py-20">
      <div className="mb-12 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">269 tools across 28 modules</p>
        <h2 className="mt-2 text-3xl font-bold text-white md:text-4xl">Everything the AI needs to edit</h2>
      </div>

      <div className="space-y-4">
        <Marquee pauseOnHover className="[--duration:35s]">
          {row1.map((t) => <ToolCard key={t.name} {...t} />)}
        </Marquee>
        <Marquee reverse pauseOnHover className="[--duration:40s]">
          {row2.map((t) => <ToolCard key={t.name} {...t} />)}
        </Marquee>
      </div>

      {/* fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-black" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-black" />
    </section>
  )
}
