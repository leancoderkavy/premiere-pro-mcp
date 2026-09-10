import type { Metadata } from "next"
import Link from "next/link"
import { ToolExplorer } from "@/components/tool-explorer"
import { TrackedLink } from "@/components/ui/tracked-link"
import catalog from "@/public/tool-catalog.json"
import { product, safeFirstPrompt } from "@/lib/product"

export const metadata: Metadata = {
  title: { absolute: "Premiere Pro MCP Tools: Search Actions & Availability" },
  description: "Find Premiere Pro MCP tools for media, captions, timelines, exports, and review workflows. Search source descriptions, action modes, and CEP or UXP availability.",
  alternates: { canonical: "/tools/" },
  openGraph: { title: "Premiere Pro MCP Tool Reference", description: "Search tools and inspect availability before planning a Premiere workflow.", url: "/tools/", type: "website" },
}

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "CollectionPage", "@id": "https://premiere-pro-mcp.com/tools/#reference", name: "Premiere Pro MCP Tool Reference", url: "https://premiere-pro-mcp.com/tools/", description: "Source-derived MCP action descriptions and availability. May include unreleased work; not a licensed-host verification record.", isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: product.name, item: "https://premiere-pro-mcp.com/" },
      { "@type": "ListItem", position: 2, name: "Tool reference", item: "https://premiere-pro-mcp.com/tools/" },
    ] },
  ],
}

export default function ToolsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <main id="main-content" className="min-h-screen bg-black px-5 py-16 text-zinc-100">
        <div className="mx-auto max-w-5xl">
          <nav aria-label="Breadcrumb" className="text-sm text-zinc-400"><Link href="/" className="text-purple-200 hover:underline">{product.name}</Link> <span aria-hidden="true">/</span> Tool reference</nav>
          <header className="border-b border-zinc-800 py-8">
            <p className="font-mono text-sm text-purple-300">PREMIERE PRO MCP TOOL REFERENCE</p>
            <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight sm:text-5xl">Find the tool for your Premiere workflow.</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300">Look up media inspection, timeline editing, captions, export, and planning tools before asking your assistant to act. Each entry includes its source description and required availability.</p>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-zinc-400">This reference is generated from development source v{catalog.sourceVersion} and may include unreleased changes. <Link href="/facts/" className="text-purple-200 underline underline-offset-4">Published package facts</Link> are tracked separately. A catalogue entry does not establish success on your Premiere host.</p>
          </header>
          <details className="border-b border-zinc-800 py-5">
            <summary className="min-h-11 cursor-pointer content-center font-semibold text-purple-200 focus-visible:ring-2 focus-visible:ring-purple-300">Availability and connection requirements</summary>
            <dl className="mt-5 grid gap-5 text-sm leading-7 sm:grid-cols-3">
              <div><dt className="font-semibold text-white">{catalog.counts.default} default-profile tools</dt><dd className="text-zinc-400">Local and CEP workflows; host prerequisites and authority checks still apply.</dd></div>
              <div><dt className="font-semibold text-white">{catalog.counts.uxp} connected UXP additions</dt><dd className="text-zinc-400">Need an authenticated, compatible UXP panel and the required advertised capabilities.</dd></div>
              <div><dt className="font-semibold text-white">{catalog.counts.restricted} restricted tools</dt><dd className="text-zinc-400">Hidden by default. Require explicit unsafe-script authority; leave disabled for initial evaluation.</dd></div>
            </dl>
            <p className="mt-5 text-sm leading-7 text-zinc-400">Your client&apos;s <code>tools/list</code> is the authority for available calls. Start with <code className="text-zinc-200">{safeFirstPrompt}</code> Then inspect <code>get_capabilities</code> and review the exact arguments before approving changes.</p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-purple-200">
              <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/docs/">Install and connect</Link>
              <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/workflows/">Try a workflow with sample media</Link>
              <a className="inline-flex min-h-11 items-center underline underline-offset-4" href="/tool-catalog.json">Download source reference JSON</a>
            </div>
          </details>
          <ToolExplorer tools={catalog.tools} />
          <aside className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">Turn a tool into a repeatable workflow</h2>
            <p className="mt-4 leading-7 text-zinc-400">Use the starter kit to inspect a disposable project, review frames, or preview a product spot. If the project helps your work, a GitHub star helps other editors find it.</p>
            <div className="mt-5 flex flex-wrap gap-5 text-purple-200">
              <TrackedLink href="/workflows/" trackingLocation="tools_reference" trackingDestination="workflow_kit" className="inline-flex min-h-11 items-center underline underline-offset-4">Get the workflow starter kit</TrackedLink>
              <TrackedLink href={product.links.repository} trackingLocation="tools_reference" trackingDestination="github" className="inline-flex min-h-11 items-center underline underline-offset-4">View or star on GitHub</TrackedLink>
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
