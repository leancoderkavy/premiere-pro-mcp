import { ArrowRight, Github, ShieldCheck } from "lucide-react"
import { TrackedLink } from "@/components/ui/tracked-link"
import { product } from "@/lib/product"

export function FinalCtaSection() {
  return (
    <section className="reveal-section border-t border-zinc-900 bg-[#050506] px-5 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-end gap-10 border-b border-zinc-800 pb-12 lg:grid-cols-[1fr_auto]">
          <div className="max-w-3xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
              Free · open source · local-first
            </p>
            <h2 className="mt-4 text-balance text-4xl font-bold tracking-[-0.04em] text-white md:text-6xl">
              Start with a connection you can verify.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
              Connect your assistant, verify the local bridge without making changes, then preview the first edit before you apply it.
            </p>
          </div>
          <TrackedLink
            href="#install"
            trackingLocation="final_cta"
            trackingDestination="safe_connection_check"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-violet-200 px-6 text-sm font-semibold text-black transition-colors hover:bg-white"
          >
            Choose your assistant
            <ArrowRight className="h-4 w-4" />
          </TrackedLink>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:gap-8">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-200" />
            Your media stays local
          </span>
          <a
            href="https://github.com/leancoderkavy/premiere-pro-mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 transition-colors hover:text-white"
          >
            <Github className="h-4 w-4" />
            MIT licensed on GitHub
          </a>
          <span>Premiere Pro {product.premiereCompatibility} · macOS and Windows</span>
        </div>
      </div>
    </section>
  )
}
