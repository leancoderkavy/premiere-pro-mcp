import { PublicPage } from "@/components/site/public-page"
import type { Metadata } from "next"
import Link from "next/link"
import { HomeLink } from "@/components/ui/home-link"
import { TrackedLink } from "@/components/ui/tracked-link"
import { articles } from "@/lib/articles"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Setup & AI Editing Guides",
  description:
    "Practical guides to setting up Premiere Pro MCP, AI-assisted editing, and Claude, ChatGPT, or Codex workflows without giving up creative control.",
  alternates: { canonical: "/blog/" },
  openGraph: {
    title: "Premiere Pro MCP Setup & AI Editing Guides",
    description:
      "Practical guides to Premiere Pro MCP setup, AI-assisted video editing, and reviewable Adobe Premiere Pro workflows.",
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

const articleDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
})

function formatArticleDate(date: string) {
  return articleDateFormatter.format(new Date(`${date}T00:00:00Z`))
}

export default function BlogPage() {
  return (
    <PublicPage>
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-site-bg px-5 py-16 text-site-text sm:py-24">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Breadcrumb" className="text-sm text-site-muted">
            <HomeLink href="/" className="hover:text-site-accent">MCP for Adobe Premiere Pro</HomeLink>{" "}
            <span aria-hidden="true">/</span> Guides
          </nav>
          <header className="max-w-3xl border-b border-site-line pb-12 pt-10 sm:pb-16">
            <p className="font-mono text-sm font-medium tracking-[0.16em] text-site-accent">MCP FOR ADOBE PREMIERE PRO GUIDES</p>
            <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-site-text sm:text-6xl">
              Set up AI-assisted Premiere workflows with confidence.
            </h1>
            <p className="mt-6 text-lg leading-8 text-site-muted">
              Learn how to set up Premiere Pro MCP, where AI can help, and how Claude, ChatGPT, and Codex
              fit into local-first, bounded, and reviewable Adobe Premiere Pro workflows.
            </p>
          </header>

          <section className="grid gap-6 py-12 md:grid-cols-2" aria-label="MCP for Adobe Premiere Pro guides">
            {articles.map((article, index) => (
              <article key={article.slug} className="flex min-h-full flex-col border border-site-line bg-site-panel p-6 transition-colors hover:border-site-accent/60 sm:p-7">
                <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-site-accent">0{index + 1} · {article.eyebrow}</p>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight text-site-text">
                  <Link href={`/blog/${article.slug}/`} className="hover:text-site-accent">{article.title}</Link>
                </h2>
                <p className="mt-4 flex-1 leading-7 text-site-muted">{article.description}</p>
                <div className="mt-7 flex items-center justify-between border-t border-site-line pt-5 text-sm">
                  <time dateTime={article.publishedAt} className="text-site-muted">{formatArticleDate(article.publishedAt)}</time>
                  <Link href={`/blog/${article.slug}/`} className="font-medium text-site-accent hover:text-site-text">
                    Read guide <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
          </section>

          <section className="border-t border-site-line py-12 sm:py-16">
            <p className="font-mono text-sm tracking-[0.14em] text-site-accent">READY TO TRY A BOUNDED WORKFLOW?</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-site-text sm:text-4xl">Start with a read-only Premiere connection check.</h2>
            <p className="mt-4 max-w-2xl leading-7 text-site-muted">
              Install the local server and connector, verify the live bridge without changing a project, then inspect your first sequence.
            </p>
            <TrackedLink
              href="/#install"
              trackingLocation="blog_hub"
              trackingDestination="safe_connection_check"
              className="mt-6 inline-flex border border-site-accent bg-site-accent px-5 py-3 font-medium text-black transition-colors hover:bg-white"
            >
              Run a safe connection check <span aria-hidden="true" className="ml-2">→</span>
            </TrackedLink>
          </section>
        </div>
      </main>
    </>
    </PublicPage>
  )
}
