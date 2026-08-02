import type { Metadata } from "next"
import Link from "next/link"
import { product, safeFirstPrompt } from "@/lib/product"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Setup, Tools, Compatibility & Security",
  description: `Choose an AI assistant, connect Premiere Pro MCP, explore ${product.coreToolCount} AI video editing tools, and understand Windows, macOS, CEP, UXP, and security support.`,
  alternates: { canonical: "/docs/" },
  openGraph: {
    title: "Premiere Pro MCP Documentation",
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
      headline: "Premiere Pro MCP setup, tools, compatibility, and security",
      description:
        "Installation and technical reference for connecting AI assistants to Adobe Premiere Pro with Premiere Pro MCP.",
      url: "https://premiere-pro-mcp.com/docs/",
      dateModified: "2026-08-01",
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
          name: "Premiere Pro MCP",
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
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-black px-5 py-16 text-zinc-100">
      <article className="mx-auto max-w-4xl">
        <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
          <Link href="/" className="hover:text-purple-300">Premiere Pro MCP</Link> <span aria-hidden="true">/</span> Documentation
        </nav>

        <header className="border-b border-zinc-800 pb-12 pt-12">
          <p className="font-mono text-sm text-purple-300">PREMIERE PRO MCP DOCUMENTATION</p>
          <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight sm:text-6xl">AI editing tools for Adobe Premiere Pro</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
            Premiere Pro MCP is an open-source, local-first Model Context Protocol server that connects AI assistants to Adobe Premiere Pro through {product.coreToolCount} structured editing, inspection, automation, and export tools.
          </p>
        </header>

        <section className="py-12" aria-labelledby="install-heading">
          <h2 id="install-heading" className="text-3xl font-semibold">Start without developer setup</h2>
          <p className="mt-5 max-w-3xl leading-8 text-zinc-400">The default route has two parts: your AI assistant gets a local server, and Premiere gets a separate connector. Claude Desktop is the recommended first route because the released bundle contains the server.</p>
          <ol className="mt-6 list-decimal space-y-3 pl-6 leading-7 text-zinc-300">
            <li><a className="font-medium text-purple-200 hover:text-white" href={product.downloads.claudeBundle}>Download the Claude Desktop bundle</a> and open it in Claude Desktop.</li>
            <li><a className="font-medium text-purple-200 hover:text-white" href={product.downloads.signedCepConnector}>Download the signed Premiere connector</a>. This is separate from the assistant bundle.</li>
            <li>Restart Claude Desktop and Premiere, then open a project.</li>
            <li>Send this read-only first prompt: <code className="rounded bg-zinc-900 px-2 py-1 text-purple-200">{safeFirstPrompt}</code></li>
          </ol>
          <p className="mt-6 leading-7 text-zinc-400">Cursor, VS Code / Copilot, and other MCP clients can use the supported local route too. A native one-click install for those clients is not currently shipped; use their MCP settings or the Advanced setup below.</p>
          <details className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-100">Advanced: npm and manual configuration</summary>
            <p className="mt-4 text-sm leading-7 text-zinc-400">This route requires Node.js {product.nodeVersion}+ and is intended for clients without a native bundle.</p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-black p-4 text-sm text-emerald-300"><code>npm install -g premiere-pro-mcp{`\n`}premiere-pro-mcp --install-cep</code></pre>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-black p-4 text-sm text-zinc-300"><code>{`{\n  "mcpServers": {\n    "premiere-pro": { "command": "premiere-pro-mcp" }\n  }\n}`}</code></pre>
          </details>
        </section>

        <section className="border-t border-zinc-800 py-12" aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="text-3xl font-semibold">What can an AI assistant do in Premiere Pro?</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {categories.map(([title, detail]) => (
              <section key={title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
                <h3 className="text-lg font-semibold text-purple-200">{title}</h3>
                <p className="mt-3 leading-7 text-zinc-400">{detail}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-800 py-12" aria-labelledby="compatibility-heading">
          <h2 id="compatibility-heading" className="text-3xl font-semibold">Windows, macOS, CEP, and UXP compatibility</h2>
          <p className="mt-5 leading-8 text-zinc-400">
            The signed CEP connector is the default compatibility route for Premiere Pro {product.premiereCompatibility} on Windows and macOS. The UXP bridge is capability-gated for compatible Premiere Pro {product.uxpMinimumVersion}+ workflows, but is not currently a Creative Cloud Marketplace install or a replacement for CEP. Compatibility is not the same as a live connection: use the safe first prompt before running a workflow.
          </p>
        </section>

        <section className="border-t border-zinc-800 py-12" aria-labelledby="security-heading">
          <h2 id="security-heading" className="text-3xl font-semibold">Local-first architecture and security</h2>
          <p className="mt-5 leading-8 text-zinc-400">
            The recommended local setup keeps Premiere Pro, the MCP server, and project media on the local computer. The first prompt runs a connection check, makes no edit, and does not ask for footage to be uploaded. Your chosen AI assistant&apos;s privacy settings still apply. Capability profiles separate inspection, editing, export, filesystem access, and unsafe scripting; raw ExtendScript is disabled by default and requires explicit operator authority.
          </p>
        </section>

        <section className="border-t border-zinc-800 py-12" aria-labelledby="resources-heading">
          <h2 id="resources-heading" className="text-3xl font-semibold">Canonical resources</h2>
          <ul className="mt-6 space-y-3 text-purple-300">
            <li><a className="hover:text-purple-200" href="https://github.com/leancoderkavy/premiere-pro-mcp">Source code and full README</a></li>
            <li><a className="hover:text-purple-200" href="https://www.npmjs.com/package/premiere-pro-mcp">npm package</a></li>
            <li><a className="hover:text-purple-200" href="https://github.com/leancoderkavy/premiere-pro-mcp/releases">Release notes</a></li>
            <li><Link className="hover:text-purple-200" href="/llms-full.txt">Machine-readable AI reference</Link></li>
          </ul>
        </section>
      </article>
      </main>
    </>
  )
}
