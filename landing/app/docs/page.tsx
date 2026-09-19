import { PublicPage } from "@/components/site/public-page"
import type { Metadata } from "next"
import Link from "next/link"
import { HomeLink } from "@/components/ui/home-link"
import { product, safeFirstPrompt } from "@/lib/product"
import { SetupGuides } from "@/components/sections/setup-guides"
import { connectorSetup, localMcpConfig } from "@/lib/client-setup"

export const metadata: Metadata = {
  title: { absolute: "MCP for Adobe Premiere Pro: Setup & Troubleshooting" },
  description: "Install the local Premiere connector, connect Claude or Codex, verify the bridge, and troubleshoot setup on Windows and macOS. Includes client-specific guides.",
  alternates: { canonical: "/docs/" },
  openGraph: {
    title: "MCP for Adobe Premiere Pro Documentation",
    description: "Setup, capabilities, compatibility, architecture, and security for AI-assisted Adobe Premiere Pro editing.",
    url: "/docs/",
    type: "article",
  },
}

const categories = [
  ["Timeline editing", "Insert, overwrite, move, trim, split, ripple-delete, target tracks, and inspect sequence structure."],
  ["Effects and color", "Apply effects, control Lumetri properties, add keyframes, use LUTs, and verify resulting values."],
  ["Media and projects", "Import footage, organize bins, create sequences, inspect metadata, manage proxies, and save projects."],
  ["Audio and captions", "Adjust verified audio levels, automate keyframes, mute tracks, create captions, and inspect audio state."],
  ["Export", "Discover Adobe Media Encoder presets, export sequences and project items, and verify frame output on disk."],
  ["Inspection and workflows", `The server registers ${product.coreToolCount} core tools. The default profile exposes ${product.defaultProfileToolCount}; a connected UXP panel exposes ${product.connectedUxpToolCount} capability-gated tools.`],
]

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://premiere-pro-mcp.com/docs/#article",
      headline: "MCP for Adobe Premiere Pro setup, tools, compatibility, and security",
      description:
        "Installation and technical reference for connecting AI assistants to Adobe Premiere Pro with MCP for Adobe Premiere Pro.",
      url: "https://premiere-pro-mcp.com/docs/",
      dateModified: "2026-09-18",
      inLanguage: "en-US",
      about: { "@id": "https://premiere-pro-mcp.com/#software" },
      isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" },
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://premiere-pro-mcp.com/docs/#breadcrumb",
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
          name: "Documentation",
          item: "https://premiere-pro-mcp.com/docs/",
        },
      ],
    },
  ],
}

export default function DocsPage() {
  return (
    <PublicPage>
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-site-bg px-5 py-16 text-site-text">
      <article className="mx-auto max-w-4xl">
        <nav aria-label="Breadcrumb" className="text-sm text-site-muted">
          <HomeLink href="/" className="hover:text-site-accent">MCP for Adobe Premiere Pro</HomeLink> <span aria-hidden="true">/</span> Documentation
        </nav>

        <header className="border-b border-site-line pb-12 pt-12">
          <p className="font-mono text-sm text-site-accent">MCP FOR ADOBE PREMIERE PRO DOCUMENTATION</p>
          <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight sm:text-6xl">AI editing tools for Adobe Premiere Pro</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-site-muted">
            MCP for Adobe Premiere Pro is an open-source, local-first Model Context Protocol server that connects AI assistants to Adobe Premiere Pro through {product.coreToolCount} structured editing, inspection, automation, and export tools.
          </p>
        </header>

        <section className="py-12" aria-labelledby="install-heading">
          <h2 id="install-heading" className="text-3xl font-semibold">Start without developer setup</h2>
          <p className="mt-5 max-w-3xl leading-8 text-site-muted">The default route has two parts: your AI assistant gets a local server, and Premiere gets a separate connector. Claude Desktop is the recommended first route because the released bundle contains the server.</p>
          <ol className="mt-6 list-decimal space-y-3 pl-6 leading-7 text-site-detail">
            <li><a className="font-medium text-site-accent hover:text-site-text" href={product.downloads.claudeBundle}>Download the Claude Desktop bundle</a> and open it in Claude Desktop.</li>
            <li><a className="font-medium text-site-accent hover:text-site-text" href={product.downloads.signedCepConnector}>Download the signed Premiere connector</a>. This is separate from the assistant bundle.</li>
            <li>Restart Claude Desktop and Premiere, then open a project.</li>
            <li>Send this read-only first prompt: <code className="rounded bg-site-raised px-2 py-1 text-site-accent">{safeFirstPrompt}</code></li>
          </ol>
          <p className="mt-6 leading-7 text-site-muted">Cursor, VS Code / Copilot, and other MCP clients can use the supported local route too. A native one-click install for those clients is not currently shipped; use their MCP settings or the Advanced setup below.</p>
          <details className="mt-8 rounded-xl border border-site-line bg-site-panel p-5">
            <summary className="cursor-pointer text-sm font-semibold text-site-text">Advanced: npm and manual configuration</summary>
            <p className="mt-4 text-sm leading-7 text-site-muted">This route requires Node.js {product.nodeVersion}+ and is intended for clients without a native bundle.</p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-site-bg p-4 text-sm text-emerald-300"><code>{connectorSetup}</code></pre>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-site-bg p-4 text-sm text-site-detail"><code>{localMcpConfig}</code></pre>
            <p className="mt-4 text-sm leading-7 text-site-muted">Merge this entry into your client settings and preserve other servers. The versioned package selects this project; another Premiere MCP package uses the same global command name. <Link href="/blog/premiere-pro-mcp-vs-adobe-premiere-pro-mcp/" className="text-site-accent underline">Check package identity</Link> before switching.</p>
          </details>
        </section>

        <SetupGuides />
        <nav aria-label="Workflow guides" className="py-8">
          <h2 className="text-xl font-semibold">After your connection check</h2>
          <ul className="mt-3 space-y-2 text-site-accent">
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/tools/">Search tool names, actions, and availability</Link></li>
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/workflows/">Try a workflow with disposable sample media</Link></li>
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/project-intake/">Review a project with the Project Intake checklist</Link></li>
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/premiere-pro-collaboration-workflow/">Compare local projects, Productions, and Team Projects</Link></li>
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/blog/claude-fable-5-1-premiere-pro-mcp/">Use Claude Fable 5.1 after the connection check</Link></li>
            <li><Link className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-site-text" href="/docs/troubleshooting/">Resolve connector and client setup problems</Link></li>
          </ul>
        </nav>
        <section className="border-t border-site-line py-12" aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="text-3xl font-semibold">What can an AI assistant do in Premiere Pro?</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {categories.map(([title, detail]) => (
              <section key={title} className="rounded-xl border border-site-line bg-site-panel p-6">
                <h3 className="text-lg font-semibold text-site-accent">{title}</h3>
                <p className="mt-3 leading-7 text-site-muted">{detail}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="border-t border-site-line py-12" aria-labelledby="compatibility-heading">
          <h2 id="compatibility-heading" className="text-3xl font-semibold">Windows, macOS, CEP, and UXP compatibility</h2>
          <p className="mt-5 leading-8 text-site-muted">
            The signed CEP connector is the default compatibility route for Premiere Pro {product.premiereCompatibility} on Windows and macOS. The UXP bridge is capability-gated for compatible Premiere Pro {product.uxpMinimumVersion}+ workflows, but is not currently a Creative Cloud Marketplace install or a replacement for CEP. Compatibility is not the same as a live connection: use the safe first prompt before running a workflow.
          </p>
        </section>

        <section className="border-t border-site-line py-12" aria-labelledby="security-heading">
          <h2 id="security-heading" className="text-3xl font-semibold">Local-first architecture and security</h2>
          <p className="mt-5 leading-8 text-site-muted">
            The recommended local setup keeps Premiere Pro, the MCP server, and project media on the local computer. The first prompt runs a connection check, makes no edit, and does not ask for footage to be uploaded. Your chosen AI assistant&apos;s privacy settings still apply. Capability profiles separate inspection, editing, export, filesystem access, and unsafe scripting; raw ExtendScript is disabled by default and requires explicit operator authority.
          </p>
        </section>

        <section className="border-t border-site-line py-12" aria-labelledby="project-context-heading">
          <h2 id="project-context-heading" className="text-3xl font-semibold">Project context: a reviewable editing workflow</h2>
          <p className="mt-5 leading-8 text-site-muted">
            The opt-in local project-context engine is designed for repeatable work that needs more evidence than a conversational request. It never captures context until the MCP client asks for it, and it does not send an entire Premiere project or customer footage into every model turn.
          </p>
          <ol className="mt-6 list-decimal space-y-3 pl-6 leading-7 text-site-detail">
            <li>Use <code className="rounded bg-site-raised px-2 py-1 text-site-accent">manage_project_context</code> to capture a bounded active-sequence snapshot locally.</li>
            <li>Use <code className="rounded bg-site-raised px-2 py-1 text-site-accent">search_project_context</code> to retrieve only relevant evidence and stable identities.</li>
            <li>Use <code className="rounded bg-site-raised px-2 py-1 text-site-accent">create_context_edit_plan</code> to generate a non-mutating candidate scaffold with stale-state guards.</li>
            <li>Use <code className="rounded bg-site-raised px-2 py-1 text-site-accent">preview_edit_plan</code> before <code className="rounded bg-site-raised px-2 py-1 text-site-accent">apply_edit_plan</code>. Apply requires the exact preview confirmation token and current target validation.</li>
          </ol>
          <p className="mt-6 leading-7 text-site-muted">
            A context plan is evidence, not mutation authority or proof that an editorial choice is correct. Clear local context when it is no longer needed.
          </p>
          <a className="mt-6 inline-flex font-medium text-site-accent hover:text-site-text" href="https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/docs/project-context-engine.md">
            Read the project-context engine guide <span aria-hidden="true" className="ml-2">→</span>
          </a>
        </section>

        <section className="border-t border-site-line py-12" aria-labelledby="resources-heading">
          <h2 id="resources-heading" className="text-3xl font-semibold">Canonical resources</h2>
          <ul className="mt-6 space-y-3 text-site-accent">
            <li><a className="hover:text-site-accent" href="https://github.com/leancoderkavy/premiere-pro-mcp">Source code and full README</a></li>
            <li><a className="hover:text-site-accent" href="https://www.npmjs.com/package/premiere-pro-mcp">npm package</a></li>
            <li><a className="hover:text-site-accent" href="https://github.com/leancoderkavy/premiere-pro-mcp/releases">Release notes</a></li>
            <li><Link className="hover:text-site-accent" href="/llms-full.txt">Machine-readable AI reference</Link></li>
          </ul>
        </section>
      </article>
      </main>
    </>
    </PublicPage>
  )
}
