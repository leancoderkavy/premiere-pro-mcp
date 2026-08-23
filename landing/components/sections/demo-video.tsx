"use client"

import { Clapperboard, Film, WandSparkles } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { product } from "@/lib/product"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

const outcomes = [
  { icon: Film, label: "Timeline", detail: "B-roll inserted on V2" },
  { icon: WandSparkles, label: "Finish", detail: "Grade and title applied" },
  { icon: Clapperboard, label: "Delivery", detail: "ProRes export queued" },
]

export function DemoVideoSection() {
  const [isPlaying, setIsPlaying] = useState(false)

  function startDemo() {
    setIsPlaying(true)
    trackOnboardingEvent("marketing_demo_played", { demo: "illustrated_workflow" })
  }

  return (
    <section id="demo" className="reveal-section overflow-hidden border-y border-zinc-900 bg-[#050506] px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Illustrated product walkthrough</p>
            <h2 className="mt-4 text-balance text-4xl font-bold tracking-[-0.035em] text-white md:text-6xl">
              From prompt to an explicit result.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-zinc-400 md:text-right">
            See the intended request-to-result flow. This animation is not a recording of a live Premiere host session.
          </p>
        </div>

        <div className="demo-video-shell relative mt-14 overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_38px_100px_rgba(0,0,0,0.58)]">
          {isPlaying ? (
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
          ) : (
            <button
              type="button"
              onClick={startDemo}
              className="group relative block aspect-video w-full overflow-hidden bg-[#060608] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-inset"
              aria-label="Play the illustrated Premiere Pro MCP workflow walkthrough"
            >
              <Image
                src="/premiere-pro-mcp-demo-poster.png"
                alt=""
                aria-hidden="true"
                fill
                sizes="(max-width: 768px) 100vw, 1152px"
                className="h-full w-full object-cover opacity-85 transition duration-300 group-hover:scale-[1.01] group-hover:opacity-100"
                loading="lazy"
              />
              <span className="absolute inset-0 grid place-items-center bg-black/20">
                <span className="rounded-full border border-white/30 bg-black/75 px-5 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur transition group-hover:border-purple-300 group-hover:bg-black/90">
                  Play illustrated walkthrough
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
