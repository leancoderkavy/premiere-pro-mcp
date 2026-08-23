import type { Metadata } from "next"
import Link from "next/link"
import { articles } from "@/lib/articles"

export const metadata: Metadata = {
  title: "Premiere Pro AI Editing & Automation Guides",
  description:
    "Practical guides to AI-assisted video editing, Premiere Pro workflow automation, and using a local MCP server without giving up creative control.",
  alternates: { canonical: "/blog/" },
  openGraph: {
    title: "Premiere Pro AI Editing & Automation Guides",
    description:
      "Practical, local-first guides to AI-assisted video editing and Adobe Premiere Pro workflow automation.",
    url: "/blog/",
    type: "website",
  },
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": "https://premiere-pro-mcp.com/blog/#collection",
  name: "MCP for Adobe Premiere Pro Guides",
  description:
    "Practical guides to AI-assisted video editing, Premiere Pro automation, and local MCP workflows.",
  url: "https://premiere-pro-mcp.com/blog/",
  isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" },
  mainEntity: {
    "@type": "ItemList",
    itemListElement: articles.map((article, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `https://premiere-pro-mcp.com/blog/${article.slug}/`,
      name: article.title,
    })),
  },
}

export default function BlogPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-black px-5 py-16 text-zinc-100 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
            <Link href="/" className="hover:text-purple-200">MCP for Adobe Premiere Pro</Link>{" "}
            <span aria-hidden="true">/</span> Guides
          </nav>
          <header className="max-w-3xl border-b border-zinc-800 pb-12 pt-10 sm:pb-16">
            <p className="font-mono text-sm font-medium tracking-[0.16em] text-purple-300">MCP FOR ADOBE PREMIERE PRO GUIDES</p>
            <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-white sm:text-6xl">
              Practical guides for AI-assisted Premiere workflows.
            </h1>
            <p className="mt-6 text-lg leading-8 text-zinc-400">
              Learn where an AI assistant can help, how structured MCP tools fit into Adobe Premiere Pro,
              and how to keep every workflow local-first, bounded, and reviewable.
            </p>
          </header>

          <section className="grid gap-6 py-12 md:grid-cols-3" aria-label="MCP for Adobe Premiere Pro guides">
            {articles.map((article, index) => (
              <article key={article.slug} className="flex min-h-full flex-col border border-zinc-800 bg-zinc-950 p-6 transition-colors hover:border-purple-400/60 sm:p-7">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-purple-300">0{index + 1} · {article.eyebrow}</p>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-white">
                  <Link href={`/blog/${article.slug}/`} className="hover:text-purple-200">{article.title}</Link>
                </h2>
                <p className="mt-4 flex-1 leading-7 text-zinc-400">{article.description}</p>
                <div className="mt-7 flex items-center justify-between border-t border-zinc-800 pt-5 text-sm">
                  <time dateTime={article.publishedAt} className="text-zinc-500">August 19, 2026</time>
                  <Link href={`/blog/${article.slug}/`} className="font-medium text-purple-200 hover:text-white">
                    Read guide <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </section>

          <section className="border-t border-zinc-800 py-12 sm:py-16">
            <p className="font-mono text-sm tracking-[0.14em] text-purple-300">READY TO TRY A BOUNDED WORKFLOW?</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Start with a read-only Premiere connection check.</h2>
            <p className="mt-4 max-w-2xl leading-7 text-zinc-400">
              Install the local server and connector, verify the live bridge without changing a project, then inspect your first sequence.
            </p>
            <Link href="/docs/" className="mt-6 inline-flex border border-purple-300 bg-purple-300 px-5 py-3 font-medium text-black transition-colors hover:bg-white">
              Read the setup guide <span aria-hidden="true" className="ml-2">→</span>
            </Link>
          </section>
        </div>
      </main>
    </>
  )
}
