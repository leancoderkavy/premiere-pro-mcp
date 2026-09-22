import { ArrowUpRight } from "lucide-react"
import { product } from "@/lib/product"

export const faqItems = [
  {
    question: "What is Premiere Pro MCP?",
    answer:
      "Premiere Pro MCP (Model Context Protocol for Adobe Premiere Pro) is a free, open-source server that connects AI assistants like Claude, Cursor, and ChatGPT to Adobe Premiere Pro. It provides structured tools for automating timeline edits, applying effects, managing media, and exporting—all with explicit confirmation and local-first privacy.",
  },
  {
    question: "Is Premiere Pro MCP free?",
    answer:
      "Yes, Premiere Pro MCP is completely free and open-source under the MIT license. There are no subscription fees, usage limits, or hidden costs. You can use it for personal or commercial projects without restrictions.",
  },
  {
    question: "Which AI assistants work with Premiere Pro MCP?",
    answer:
      "Claude Desktop (recommended starting point with a self-contained bundle), Cursor, VS Code with GitHub Copilot, Windsurf, and any MCP-compatible AI client. The Premiere connector is installed separately and works with all supported clients.",
  },
  {
    question: "What can I automate in Premiere Pro with AI?",
    answer:
      "You can automate timeline editing (insert, trim, split clips), apply effects and color correction, manage audio levels, create captions, organize project bins, import media, export sequences with Adobe Media Encoder presets, and inspect project metadata. Every action requires explicit confirmation before being applied.",
  },
  {
    question: "Which Premiere Pro versions are supported?",
    answer:
      `The signed CEP connector works with Adobe Premiere Pro ${product.premiereCompatibility} on macOS (Apple Silicon and Intel) and Windows. The UXP bridge adds capability-gated workflows for Premiere ${product.uxpMinimumVersion}+ hosts but is not the default installer.`,
  },
  {
    question: "Does Premiere Pro MCP upload my footage or project files?",
    answer:
      "No. The recommended setup is local-first: Premiere Pro, the MCP server, and the bridge all run on your machine. No project media is automatically uploaded. The bridge exchanges structured commands and results locally via private temp files. Your AI assistant's separate privacy settings still apply to the prompts you send.",
  },
  {
    question: "How do I install Premiere Pro MCP?",
    answer:
      "For Claude Desktop: download the released bundle and the signed Premiere connector, restart both apps, and send a safe first prompt to verify the connection. For other AI clients: install via npm (premiere-pro-mcp), add the MCP config to your client settings, install the CEP connector, and restart. Full setup guides are available in the documentation.",
  },
  {
    question: "Can I use Premiere Pro MCP remotely or on a render farm?",
    answer:
      "A remote HTTP transport exists but requires authentication and a working connection back to the local Premiere Pro bridge. For most editors, the local setup is simpler, safer, and faster. Remote access is not designed for render farm deployments without local Premiere hosts.",
  },
]

const faqStructuredData = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqItems.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.answer,
    },
  })),
}

export function FaqSection() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />
      <section id="faq" className="reveal-section bg-black px-5 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
          <div>
            <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
              Premiere Pro MCP <span className="text-purple-400">FAQ</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-zinc-400">
              Common questions about AI automation for Adobe Premiere Pro: pricing, compatibility, privacy, installation, and supported AI assistants.
            </p>
            <a
              href="https://github.com/leancoderkavy/premiere-pro-mcp#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-purple-300 transition-colors hover:text-purple-200"
            >
              Read the complete documentation <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          <div className="divide-y divide-zinc-800 border-y border-zinc-800">
            {faqItems.map((item) => (
              <details key={item.question} className="faq-item group py-6">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-base font-semibold text-zinc-100 marker:content-none">
                  {item.question}
                  <span className="mt-0.5 text-xl font-light leading-none text-purple-300 transition-transform duration-300 group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="max-w-2xl pt-4 text-sm leading-7 text-zinc-400">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
