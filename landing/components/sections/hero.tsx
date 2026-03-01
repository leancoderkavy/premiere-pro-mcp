"use client"

import { Particles } from "@/components/ui/particles"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { BorderBeam } from "@/components/ui/border-beam"
import { Github, Package, Zap } from "lucide-react"

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center">
      <Particles
        className="absolute inset-0 z-0"
        quantity={120}
        color="#ffffff"
        staticity={30}
      />

      {/* Badge */}
      <div className="relative z-10 mb-6">
        <AnimatedGradientText>
          <Zap className="mr-2 inline h-4 w-4" />
          269 tools &mdash; the most complete MCP server for video editing
        </AnimatedGradientText>
      </div>

      {/* Headline */}
      <h1 className="relative z-10 mb-6 max-w-4xl text-5xl font-bold leading-tight tracking-tight text-white md:text-7xl">
        Give AI full control over{" "}
        <span className="bg-gradient-to-r from-[#9999FF] via-[#c4c4ff] to-[#9999FF] bg-clip-text text-transparent">
          Adobe Premiere Pro
        </span>
      </h1>

      <p className="relative z-10 mb-10 max-w-2xl text-lg text-zinc-400 md:text-xl">
        An MCP server that lets Claude, Windsurf, Cursor, and any MCP‑compatible AI
        directly edit timelines, apply effects, manage keyframes, and export — via 28 tool modules.
      </p>

      {/* CTA buttons */}
      <div className="relative z-10 flex flex-wrap items-center justify-center gap-4">
        <ShimmerButton
          shimmerColor="#9999ff"
          background="rgba(153,153,255,0.15)"
          borderRadius="8px"
          className="h-12 px-8 text-base font-semibold"
          onClick={() => window.open("https://github.com/ppmcp/premiere-pro-mcp", "_blank")}
        >
          <Github className="mr-2 h-5 w-5" />
          View on GitHub
        </ShimmerButton>

        <a
          href="https://www.npmjs.com/package/premiere-pro-mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center gap-2 rounded-lg border border-zinc-700 px-8 text-base font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          <Package className="h-5 w-5" />
          npm install
        </a>
      </div>

      {/* Terminal preview card */}
      <div className="relative z-10 mt-16 w-full max-w-2xl">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-purple-500/10">
          <BorderBeam colorFrom="#9999ff" colorTo="#ff6699" duration={8} />
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
            <div className="h-3 w-3 rounded-full bg-red-500/80" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <div className="h-3 w-3 rounded-full bg-green-500/80" />
            <span className="ml-2 text-xs text-zinc-500">premiere-pro-mcp</span>
          </div>
          <pre className="overflow-x-auto p-6 text-left text-sm leading-relaxed">
            <code>
              <span className="text-zinc-500">$ </span>
              <span className="text-green-400">npm install -g premiere-pro-mcp</span>
              {"\n"}
              <span className="text-zinc-500">$ </span>
              <span className="text-green-400">premiere-pro-mcp --install-cep</span>
              {"\n\n"}
              <span className="text-zinc-400"># AI prompt:</span>
              {"\n"}
              <span className="text-white">"Add the B-roll to V2, cross dissolve between clips,</span>
              {"\n"}
              <span className="text-white"> color correct to match A-roll, export 1080p ProRes."</span>
              {"\n\n"}
              <span className="text-zinc-500">[premiere-pro-mcp] </span>
              <span className="text-purple-400">Registered 269 tools + 2 resources ✓</span>
            </code>
          </pre>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 animate-bounce">
        <div className="h-8 w-5 rounded-full border-2 border-zinc-600 flex items-start justify-center pt-1">
          <div className="h-2 w-0.5 rounded-full bg-zinc-400 animate-pulse" />
        </div>
      </div>
    </section>
  )
}
