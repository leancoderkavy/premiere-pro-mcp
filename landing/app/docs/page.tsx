import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Setup, Tools, Compatibility & Security",
  description: "Install Premiere Pro MCP, connect Claude, Cursor, or Windsurf, explore 269 AI video editing tools, and understand Windows, macOS, CEP, UXP, and security support.",
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
  ["Inspection and workflows", "Use 269 tools, three resources, four prompts, edit-plan previews, capability profiles, and audit events."],
]

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-black px-5 py-16 text-zinc-100">
      <article className="mx-auto max-w-4xl">
        <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
          <Link href="/" className="hover:text-purple-300">Premiere Pro MCP</Link> <span aria-hidden="true">/</span> Documentation
        </nav>

        <header className="border-b border-zinc-800 pb-12 pt-12">
          <p className="font-mono text-sm text-purple-300">PREMIERE PRO MCP DOCUMENTATION</p>
          <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight sm:text-6xl">AI editing tools for Adobe Premiere Pro</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
            Premiere Pro MCP is an open-source, local-first Model Context Protocol server that connects AI assistants to Adobe Premiere Pro through 269 structured editing, inspection, automation, and export tools.
          </p>
        </header>

        <section className="py-12" aria-labelledby="install-heading">
          <h2 id="install-heading" className="text-3xl font-semibold">How to install Premiere Pro MCP</h2>
          <ol className="mt-6 list-decimal space-y-3 pl-6 leading-7 text-zinc-300">
            <li>Install Node.js 18 or newer on Windows or macOS.</li>
            <li>Run <code className="rounded bg-zinc-900 px-2 py-1 text-purple-200">npm install -g premiere-pro-mcp</code>.</li>
            <li>Run <code className="rounded bg-zinc-900 px-2 py-1 text-purple-200">premiere-pro-mcp --install-cep</code>.</li>
            <li>Configure Claude Desktop, Cursor, Windsurf, or another MCP client to launch <code className="rounded bg-zinc-900 px-2 py-1 text-purple-200">premiere-pro-mcp</code>.</li>
            <li>Open Premiere Pro and call <code className="rounded bg-zinc-900 px-2 py-1 text-purple-200">ping</code> to verify the live bridge.</li>
          </ol>
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
            The packaged CEP bridge targets Premiere Pro 2020 through 2026 on Windows and macOS. The UXP bridge is a preview for Premiere Pro 25.6 and newer. Compatibility is not the same as a live connection: always call <code className="text-purple-200">get_capabilities</code> and <code className="text-purple-200">ping</code> on the editor&apos;s machine before running a workflow.
          </p>
        </section>

        <section className="border-t border-zinc-800 py-12" aria-labelledby="security-heading">
          <h2 id="security-heading" className="text-3xl font-semibold">Local-first architecture and security</h2>
          <p className="mt-5 leading-8 text-zinc-400">
            The recommended stdio setup keeps Premiere Pro, the MCP server, and project media on the local computer. Capability profiles separate inspection, editing, export, filesystem access, and unsafe scripting. Raw ExtendScript is disabled by default and requires explicit operator authority.
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
  )
}
