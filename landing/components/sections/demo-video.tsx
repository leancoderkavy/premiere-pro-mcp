"use client"

import { Clapperboard, Film, WandSparkles } from "lucide-react"
import { useState } from "react"
import { product } from "@/lib/product"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

const outcomes = [
  { icon: Film, label: "Timeline", detail: "Three clips assembled" },
  { icon: WandSparkles, label: "Finish", detail: "Review markers added" },
  { icon: Clapperboard, label: "Delivery", detail: "Editable project saved" },
]

export function DemoVideoSection() {
  const [isPlaying, setIsPlaying] = useState(false)

  function startDemo() {
    setIsPlaying(true)
    trackOnboardingEvent("marketing_demo_played", { demo: "cinematic_ad_v3" })
  }

  return (
    <section id="demo" className="reveal-section overflow-hidden border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Recorded in Premiere Pro</p>
            <h2 className="mt-4 text-balance text-4xl font-bold tracking-[-0.035em] text-white md:text-6xl">
              From prompt to an explicit result.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-zinc-400 md:text-right">
            Watch three coastal clips become a 15-second sequence with review markers and a saved project. Recorded in Premiere Pro using original sample artwork.
          </p>
        </div>

        <div className="demo-video-shell relative mt-14 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_38px_100px_rgba(0,0,0,0.58)]">
          {isPlaying ? (
            <video
              className="aspect-video w-full bg-[#060608]"
              controls
              autoPlay
              loop
              playsInline
              preload="metadata"
              poster="/premiere-pro-mcp-ad-v3-poster-1280.webp"
              aria-label="Live Premiere Pro recording: three clips assembled, review markers added, and project saved"
            >
              <source src="/premiere-pro-mcp-ad-v3.mp4" type="video/mp4" />
              <track kind="captions" src="/premiere-pro-mcp-ad-v3.vtt" srcLang="en" label="English" />
              Your browser does not support embedded video. The demo shows an AI request becoming a structured Premiere Pro edit.
            </video>
          ) : (
            <button
              type="button"
              onClick={startDemo}
              className="group relative block aspect-video w-full overflow-hidden bg-[#060608] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-inset"
              aria-label="Play the live MCP for Adobe Premiere Pro workflow walkthrough"
            >
              {/* Static export uses pre-sized files instead of a runtime image service. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/premiere-pro-mcp-ad-v3-poster-1280.webp"
                srcSet="/premiere-pro-mcp-ad-v3-poster-640.webp 640w, /premiere-pro-mcp-ad-v3-poster-1280.webp 1280w"
                alt=""
                aria-hidden="true"
                width={1280}
                height={720}
                sizes="(max-width: 1192px) calc(100vw - 40px), 1152px"
                className="h-full w-full object-cover opacity-85 transition duration-300 group-hover:scale-[1.01] group-hover:opacity-100"
                loading="lazy"
              />
              <span className="absolute inset-0 grid place-items-center bg-black/20">
                <span className="rounded-full border border-white/30 bg-black/75 px-5 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur transition group-hover:border-purple-300 group-hover:bg-black/90">
                  Play live walkthrough · 30 sec
                </span>
              </span>
            </button>
          )}
          <span className="pointer-events-none absolute right-[3%] top-[4%] rounded bg-[#09090d] px-2 py-1 font-mono text-[9px] text-zinc-400 sm:text-[11px]">
            LOCAL BRIDGE · {product.coreToolCount} TOOLS
          </span>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-300/60 to-transparent" aria-hidden="true" />
        </div>

        <div className="mt-8 grid border-t border-zinc-800 sm:grid-cols-3">
          {outcomes.map((outcome) => (
            <div key={outcome.label} className="flex items-center gap-4 border-b border-zinc-800 py-5 sm:border-b-0 sm:border-r sm:px-6 first:sm:pl-0 last:sm:border-r-0">
              <outcome.icon className="h-5 w-5 shrink-0 text-purple-300" strokeWidth={1.6} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">{outcome.label}</p>
                <p className="mt-1 text-sm text-zinc-200">{outcome.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
