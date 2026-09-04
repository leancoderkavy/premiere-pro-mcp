import { Captions, Check, Layers3, Play, Sparkles } from "lucide-react"

const clips = [
  { label: "Interview_A", start: "2%", width: "31%", color: "bg-[#6557c8]", delay: "80ms" },
  { label: "B-roll_City", start: "35%", width: "25%", color: "bg-[#7b66d9]", delay: "180ms" },
  { label: "Product_Closeup", start: "62%", width: "36%", color: "bg-[#8f72e8]", delay: "280ms" },
] as const

const brollClips = [
  { label: "B-roll_01", start: "14%", width: "23%", delay: "320ms" },
  { label: "B-roll_02", start: "44%", width: "28%", delay: "400ms" },
] as const

const waveform = [8, 14, 10, 19, 12, 23, 16, 9, 18, 25, 13, 21, 10, 17, 24, 12, 20, 15, 9, 18, 13, 22, 11, 16]

export function EditingTimeline() {
  return (
    <div
      className="hero-enter hero-enter-4 mx-auto mt-10 max-w-4xl overflow-hidden rounded-xl border border-zinc-800 bg-[#08080a] shadow-[0_24px_64px_rgba(0,0,0,0.4)] md:mt-14"
      aria-label="Illustrated Premiere Pro editing workflow"
    >
      <div className="flex h-11 items-center border-b border-zinc-800 bg-[#111114] px-4">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/75" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/75" />
        </div>
        <span className="ml-4 font-mono text-[11px] text-zinc-500">Sequence 01 · Premiere Pro</span>
        <span className="status-pulse ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          MCP connected
        </span>
      </div>

      <div className="grid md:grid-cols-[0.72fr_1.28fr]">
        <div className="relative min-h-44 overflow-hidden bg-[#050506] p-4 md:min-h-72 md:border-r md:p-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_28%,rgba(139,124,255,0.12),transparent_43%)]" />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              <span>Program</span>
              <span>00:00:08:12</span>
            </div>

            <div className="my-auto py-4 md:py-6">
              <div className="timeline-copy-enter mx-auto max-w-[15rem]">
                <p className="text-balance text-center text-xl font-semibold leading-tight tracking-[-0.03em] text-white md:text-2xl">
                  Keep the creative call.
                  <span className="block text-violet-200">Automate the repeatable work.</span>
                </p>
                <div className="mx-auto mt-5 h-px w-16 bg-violet-300/60" />
              </div>
            </div>

            <div className="hidden items-center justify-center gap-4 text-zinc-500 md:flex" aria-hidden="true">
              <span className="font-mono text-[10px]">1/2</span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-800 text-zinc-200">
                <Play className="ml-0.5 h-3 w-3 fill-current" />
              </span>
              <span className="font-mono text-[10px]">Fit</span>
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 bg-[#0b0b0e] md:block" aria-hidden="true">
          <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <Layers3 className="h-3.5 w-3.5 text-violet-300" />
              <span className="font-medium text-zinc-300">Timeline</span>
              <span>1080p · 23.976 fps</span>
            </div>
            <span className="timeline-copy-enter inline-flex items-center gap-1 rounded bg-violet-300/10 px-2 py-1 text-[9px] text-violet-100" style={{ animationDelay: "750ms" }}>
              <Sparkles className="h-3 w-3" />
              B-roll matched
            </span>
          </div>

          <div className="relative p-3 pl-12">
            <div className="absolute inset-y-3 left-0 w-10 border-r border-zinc-800 bg-[#0d0d10]">
              {["V2", "V1", "A1"].map((track) => (
                <div key={track} className="flex h-12 items-center justify-center border-b border-zinc-800 font-mono text-[9px] text-zinc-600">
                  {track}
                </div>
              ))}
            </div>

            <div className="relative overflow-hidden">
              <div className="mb-1 flex h-4 justify-between border-b border-zinc-800 font-mono text-[8px] text-zinc-700">
                <span>00:00</span>
                <span>00:05</span>
                <span>00:10</span>
                <span>00:15</span>
              </div>

              <div className="relative h-12 border-b border-zinc-800/80">
                {brollClips.map((clip) => (
                  <div
                    key={clip.label}
                    className="timeline-clip-enter absolute top-1 flex h-9 origin-left items-center overflow-hidden rounded-sm border border-pink-300/20 bg-[#874c78] px-2 text-[9px] text-pink-100"
                    style={{ left: clip.start, width: clip.width, animationDelay: clip.delay }}
                  >
                    <Captions className="mr-1.5 h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate">{clip.label}</span>
                  </div>
                ))}
              </div>

              <div className="relative h-12 border-b border-zinc-800/80">
                {clips.map((clip) => (
                  <div
                    key={clip.label}
                    className={`timeline-clip-enter absolute top-1 flex h-9 origin-left items-center overflow-hidden rounded-sm border border-white/10 px-2 text-[9px] text-violet-100 ${clip.color}`}
                    style={{ left: clip.start, width: clip.width, animationDelay: clip.delay }}
                  >
                    <Sparkles className="mr-1.5 h-3 w-3 shrink-0 opacity-60" />
                    <span className="truncate">{clip.label}</span>
                  </div>
                ))}
              </div>

              <div className="relative flex h-12 items-center gap-[3px] overflow-hidden border-b border-zinc-800/80 bg-emerald-500/[0.03] px-1">
                {waveform.map((height, index) => (
                  <span
                    key={`${height}-${index}`}
                    className="timeline-waveform-bar min-w-[2px] flex-1 rounded-full bg-emerald-400/45"
                    style={{ height, animationDelay: `${index * 25}ms`, animationDuration: `${1.2 + (index % 4) * 0.16}s` }}
                  />
                ))}
              </div>

              <div className="timeline-playhead pointer-events-none absolute bottom-0 top-3 z-20 w-px bg-[#f2a7d2] shadow-[0_0_10px_rgba(242,167,210,0.65)]" style={{ left: "4%" }}>
                <span className="absolute -left-[3px] -top-1 h-0 w-0 border-l-[3px] border-r-[3px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#f2a7d2]" />
              </div>
            </div>
          </div>

          <div className="timeline-copy-enter flex items-center justify-between border-t border-zinc-800 bg-[#0f0f12] px-4 py-2.5 text-[10px]" style={{ animationDelay: "900ms" }}>
            <span className="inline-flex items-center gap-1.5 text-zinc-500">
              <Check className="h-3 w-3 text-emerald-400" />
              3 edits applied and verified
            </span>
            <span className="font-mono text-zinc-600">ProRes 422</span>
          </div>
        </div>
      </div>
    </div>
  )
}
