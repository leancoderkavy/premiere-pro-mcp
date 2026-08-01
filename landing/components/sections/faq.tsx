import { ArrowUpRight } from "lucide-react"
import { product } from "@/lib/product"

export const faqItems = [
  {
    question: "What is Premiere Pro MCP?",
    answer:
      "Premiere Pro MCP is an open-source Model Context Protocol server that gives compatible AI clients a structured set of tools for editing timelines, applying effects, managing media, and exporting from Adobe Premiere Pro.",
  },
  {
    question: "Which Premiere Pro versions and operating systems are supported?",
    answer:
      `The signed CEP connector is the default route for Adobe Premiere Pro ${product.premiereCompatibility} on macOS and Windows, including Apple Silicon and Intel Macs. The UXP bridge adds capability-gated workflows on compatible Premiere ${product.uxpMinimumVersion}+ hosts; it is not the default installer.`,
  },
  {
    question: "Does Premiere Pro MCP upload my footage?",
    answer:
      "The recommended setup is local-first. Premiere Pro, the connector, and the MCP server run on your machine, and the bridge exchanges commands and structured results rather than automatically uploading project media. Your AI assistant’s separate privacy settings still apply.",
  },
  {
    question: "Which AI clients can connect to it?",
    answer:
      "Claude Desktop has a released self-contained bundle and is the recommended starting point. Cursor, VS Code / Copilot, Windsurf, and other MCP-compatible clients can use the local server route. A native one-click installer for every client is not currently shipped.",
  },
  {
    question: "Can I use the MCP server remotely?",
    answer:
      "A remote HTTP transport is available, but it requires authentication and a working connection back to the local Premiere Pro bridge. For most editors, the local setup is simpler and safer.",
  },
]

export function FaqSection() {
  return (
    <section id="faq" className="reveal-section bg-black px-5 py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
        <div>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
            Premiere Pro MCP <span className="text-purple-400">FAQ</span>
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-zinc-400">
            Straight answers about compatibility, privacy, AI clients, and remote access.
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
  )
}
