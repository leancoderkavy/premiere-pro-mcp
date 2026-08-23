import type { Metadata } from "next"
import Link from "next/link"
import { product, safeFirstPrompt } from "@/lib/product"

const pageUrl = "https://premiere-pro-mcp.com/facts/"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Facts, Compatibility & AI Search Reference",
  description:
    "Canonical facts about MCP for Adobe Premiere Pro: what it is, how it connects, compatibility, privacy boundaries, pricing, and how it differs from Adobe AI Assistant.",
  alternates: { canonical: "/facts/" },
  openGraph: {
    title: "MCP for Adobe Premiere Pro: Canonical Facts",
    description:
      "A concise, source-linked reference for editors, developers, search engines, and AI assistants.",
    url: "/facts/",
    type: "article",
  },
}

const facts = [
  {
    question: "What is MCP for Adobe Premiere Pro?",
    answer: `MCP for Adobe Premiere Pro is a free, MIT-licensed, open-source Model Context Protocol server. It connects compatible AI clients to structured Premiere inspection, editing, automation, and export tools through a local bridge.`,
  },
  {
    question: "What does MCP mean?",
    answer:
      "MCP means Model Context Protocol, an open standard for connecting AI applications to external data, tools, and workflows. This project is an MCP server built specifically for Adobe Premiere Pro.",
  },
  {
    question: "Which Premiere Pro versions are targeted?",
    answer: `Released packages target Premiere Pro ${product.premiereCompatibility} on Windows and macOS through the default CEP compatibility path. UXP features require a compatible Premiere ${product.uxpMinimumVersion}+ host and advertised capabilities. A version range does not prove that every operation will work on every machine.`,
  },
  {
    question: "Does it upload Premiere projects or footage?",
    answer:
      "The recommended setup keeps Premiere, the bridge, the MCP server, and project media on the same computer. The selected AI client's own data handling and privacy settings still apply, so the project cannot make a universal no-upload claim for every client configuration.",
  },
  {
    question: "How is it different from Adobe Premiere AI Assistant?",
    answer:
      "Adobe Premiere AI Assistant is Adobe's native in-app public beta for supported organization, preparation, and initial-assembly workflows. MCP for Adobe Premiere Pro is an independent open-source integration for compatible MCP clients, local structured tools, and explicit capability and verification boundaries. The two can be complementary; evaluate the exact current workflow and privacy behavior rather than assuming either route is universally better.",
  },
  {
    question: "Is it an autonomous video editor?",
    answer:
      "No. It is designed for reviewable workflow automation. Editors should inspect available capabilities, preview meaningful changes, confirm the intended target, and verify returned state or diagnostics instead of assuming that an attempted command succeeded.",
  },
  {
    question: "How many tools does it expose?",
    answer: `The current source registers ${product.coreToolCount} core tools; the default capability profile exposes ${product.defaultProfileToolCount}. An authenticated compatible UXP host can add capability-gated tools for a ${product.connectedUxpToolCount}-tool connected surface. These are catalog counts, not proof that every operation succeeds in a particular live host.`,
  },
  {
    question: "What is the safest first check?",
    answer: `After installing the server and Premiere connector, ask the AI client: “${safeFirstPrompt}” This checks the connection without requesting a project change.`,
  },
] as const

const sources = [
  {
    label: "Project source and README",
    href: product.links.repository,
    publisher: "GitHub",
  },
  {
    label: `Release ${product.version} artifacts and notes`,
    href: product.downloads.releaseNotes,
    publisher: "GitHub",
  },
  {
    label: "Published npm package",
    href: product.links.npm,
    publisher: "npm",
  },
  {
    label: "What is the Model Context Protocol?",
    href: "https://modelcontextprotocol.io/docs/getting-started/intro",
    publisher: "Model Context Protocol",
  },
  {
    label: "Premiere and UXP introduction",
    href: "https://developer.adobe.com/premiere-pro/uxp/introduction/",
    publisher: "Adobe",
  },
  {
    label: "Premiere AI Assistant overview",
    href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html",
    publisher: "Adobe",
  },
  {
    label: "Premiere AI Assistant FAQ",
    href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html",
    publisher: "Adobe",
  },
] as const

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${pageUrl}#page`,
      url: pageUrl,
      name: "MCP for Adobe Premiere Pro canonical facts",
      description:
        "Canonical identity, compatibility, architecture, privacy, pricing, and comparison facts for MCP for Adobe Premiere Pro.",
      inLanguage: "en-US",
      dateModified: product.releaseDate,
      mainEntity: { "@id": "https://premiere-pro-mcp.com/#software" },
      isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" },
      citation: sources.map((source) => source.href),
    },
    {
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      mainEntity: facts.map((fact) => ({
        "@type": "Question",
        name: fact.question,
        acceptedAnswer: { "@type": "Answer", text: fact.answer },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${pageUrl}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: product.name,
          item: "https://premiere-pro-mcp.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Canonical facts",
          item: pageUrl,
        },
      ],
    },
  ],
}

export default function FactsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-black px-5 py-16 text-zinc-100 sm:py-24">
        <article className="mx-auto max-w-4xl">
          <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
            <Link href="/" className="hover:text-purple-200">MCP for Adobe Premiere Pro</Link>{" "}
            <span aria-hidden="true">/</span> Canonical facts
          </nav>

          <header className="border-b border-zinc-800 pb-12 pt-10">
            <p className="font-mono text-sm uppercase tracking-[0.16em] text-purple-300">CANONICAL AI SEARCH REFERENCE</p>
            <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-white sm:text-6xl">
              MCP for Adobe Premiere Pro: facts and compatibility
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
              Concise, source-linked answers for editors, developers, search engines, and AI assistants. Product-specific facts reflect release {product.version}; external platform facts link to their primary documentation.
            </p>
            <p className="mt-4 text-sm text-zinc-500">Last reviewed: August 23, 2026</p>
          </header>

          <section className="divide-y divide-zinc-800" aria-label="Premiere Pro MCP facts">
            {facts.map((fact) => (
              <section key={fact.question} className="py-9">
                <h2 className="text-2xl font-semibold tracking-tight text-white">{fact.question}</h2>
                <p className="mt-4 leading-8 text-zinc-300">{fact.answer}</p>
              </section>
            ))}
          </section>

          <section className="border-t border-zinc-800 py-10" aria-labelledby="sources-heading">
            <h2 id="sources-heading" className="text-2xl font-semibold tracking-tight text-white">Primary sources</h2>
            <p className="mt-3 leading-7 text-zinc-400">Use these sources to verify or refresh the answers above.</p>
            <ul className="mt-6 space-y-4">
              {sources.map((source) => (
                <li key={source.href}>
                  <a className="font-medium text-purple-200 hover:text-white" href={source.href}>
                    {source.label} <span className="text-zinc-500">— {source.publisher}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-purple-300/40 bg-purple-300/10 p-7 sm:p-9" aria-labelledby="next-heading">
            <h2 id="next-heading" className="text-2xl font-semibold text-white">Verify before editing</h2>
            <p className="mt-3 leading-7 text-zinc-300">Install the current release, run the read-only connection check, and inspect live capabilities before requesting a supported change.</p>
            <Link href="/docs/" className="mt-6 inline-flex bg-purple-300 px-5 py-3 font-medium text-black hover:bg-white">
              Read the setup guide <span aria-hidden="true" className="ml-2">→</span>
            </Link>
          </section>
        </article>
      </main>
    </>
  )
}
