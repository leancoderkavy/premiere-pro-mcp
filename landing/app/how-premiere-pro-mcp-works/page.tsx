import { PublicPage } from "@/components/site/public-page"
import type { Metadata } from "next"
import Link from "next/link"
import { HomeLink } from "@/components/ui/home-link"
import { product, safeFirstPrompt } from "@/lib/product"
import Image from "next/image"
import { ArrowRight, CheckCircle2, AlertTriangle, ShieldCheck, Zap } from "lucide-react"

export const metadata: Metadata = {
  title: "How Premiere Pro MCP Works | Technical Architecture & Workflow",
  description: "Learn how Premiere Pro MCP connects AI assistants to Adobe Premiere Pro using a local-first architecture with CEP bridges, file-based IPC, and explicit confirmation.",
  alternates: { canonical: "/how-premiere-pro-mcp-works/" },
  openGraph: {
    title: "How Premiere Pro MCP Works | Technical Architecture",
    description: "Understand the technical architecture behind Premiere Pro MCP: local bridges, file-based communication, and explicit confirmation workflow.",
    url: "/how-premiere-pro-mcp-works/",
    type: "article",
  },
}

const workflowSteps = [
  {
    number: "1",
    title: "You send a prompt to your AI assistant",
    description:
      "In Claude, Cursor, or another MCP-compatible client, you describe what you want to edit in natural language: 'Split all clips at 5 seconds' or 'Add a cross dissolve between clips.'",
  },
  {
    number: "2",
    title: "AI calls the appropriate MCP tool",
    description:
      "Your AI assistant analyzes your request and calls one or more tools provided by Premiere Pro MCP with structured parameters (e.g., split_clip with a specific time code).",
  },
  {
    number: "3",
    title: "MCP server generates a command script",
    description:
      "The MCP server translates the tool call into an ES3 ExtendScript command file that's safe for Premiere Pro to execute. This file is written to a private temp directory.",
  },
  {
    number: "4",
    title: "Premiere connector executes the command",
    description:
      "The CEP plugin running inside Premiere Pro polls the temp directory, detects the new command file, executes it via Premiere's scripting API, and writes a structured JSON result back.",
  },
  {
    number: "5",
    title: "MCP server returns the result",
    description:
      "The server reads the result file, verifies the operation succeeded, and returns structured data to your AI assistant showing what changed (or what went wrong).",
  },
  {
    number: "6",
    title: "AI presents the result and waits for confirmation",
    description:
      "Your AI assistant shows you a preview of what happened or what will happen, and asks for explicit confirmation before applying destructive changes.",
  },
]

const securityPrinciples = [
  {
    icon: ShieldCheck,
    title: "Local-first architecture",
    description:
      "Everything runs on your machine. The MCP server, Premiere Pro, and the bridge all communicate through private temp files. No project data or media is uploaded to the internet.",
  },
  {
    icon: CheckCircle2,
    title: "Explicit confirmation required",
    description:
      "Mutating operations (edits, exports) require preview and explicit confirmation. You see exactly what will change before it happens. Read-only inspection tools don't require confirmation.",
  },
  {
    icon: AlertTriangle,
    title: "Capability-based authority",
    description:
      "Tools are grouped by capability (inspect, edit, export, filesystem, unsafe-script). You can disable dangerous capabilities like raw ExtendScript execution without breaking safe workflows.",
  },
  {
    icon: Zap,
    title: "Verification with readback",
    description:
      "After mutating operations, the MCP server reads back Premiere Pro's state to verify the change was actually applied. Results are marked as 'verified', 'committed_unverified', or 'failed'.",
  },
]

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      "@id": "https://premiere-pro-mcp.com/how-premiere-pro-mcp-works/#article",
      headline: "How Premiere Pro MCP Works: Technical Architecture & Workflow",
      description:
        "Technical deep-dive into how Premiere Pro MCP connects AI assistants to Adobe Premiere Pro using local-first architecture, file-based IPC, and explicit confirmation.",
      url: "https://premiere-pro-mcp.com/how-premiere-pro-mcp-works/",
      dateModified: new Date().toISOString().split("T")[0],
      inLanguage: "en-US",
      about: { "@id": "https://premiere-pro-mcp.com/#software" },
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://premiere-pro-mcp.com/how-premiere-pro-mcp-works/#breadcrumb",
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
          name: "How Premiere Pro MCP Works",
          item: "https://premiere-pro-mcp.com/how-premiere-pro-mcp-works/",
        },
      ],
    },
  ],
}

export default function HowPremiereProMcpWorksPage() {
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
              <HomeLink href="/" className="hover:text-site-accent">
                MCP for Adobe Premiere Pro
              </HomeLink>{" "}
              <span aria-hidden="true">/</span> How it works
            </nav>

            <header className="border-b border-site-line pb-12 pt-12">
              <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
                How Premiere Pro MCP Works
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-site-muted">
                Premiere Pro MCP uses a <strong className="text-site-text">local-first, file-based architecture</strong> to connect AI assistants to Adobe Premiere Pro. This page explains the technical workflow, security model, and communication protocol.
              </p>
            </header>

            <section className="border-b border-site-line py-12" aria-labelledby="architecture-heading">
              <h2 id="architecture-heading" className="text-3xl font-semibold">
                Architecture overview
              </h2>
              <figure className="mt-8 overflow-hidden rounded-xl border border-site-line bg-black">
                <Image
                  src="/marketing/premiere-pro-mcp-workflow-v1.png"
                  alt="Local-first workflow: an AI assistant sends a request through the MCP bridge to Premiere, which returns a verified result."
                  width={1672}
                  height={941}
                  sizes="(max-width: 768px) 100vw, 1152px"
                  className="h-auto w-full"
                />
                <figcaption className="border-t border-site-line px-5 py-4 text-sm leading-6 text-site-muted">
                  The recommended path keeps the AI assistant, MCP server, Premiere Pro, and project media on the same computer.
                </figcaption>
              </figure>
              <p className="mt-8 leading-8 text-site-muted">
                Premiere Pro MCP consists of three components that work together:
              </p>
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-site-line bg-site-panel p-6">
                  <h3 className="text-lg font-semibold text-site-accent">Your AI Assistant</h3>
                  <p className="mt-2 leading-7 text-site-muted">
                    Claude Desktop, Cursor, VS Code, or any MCP-compatible client. The AI analyzes your natural language prompts and decides which MCP tools to call.
                  </p>
                </div>
                <div className="rounded-xl border border-site-line bg-site-panel p-6">
                  <h3 className="text-lg font-semibold text-site-accent">The MCP Server</h3>
                  <p className="mt-2 leading-7 text-site-muted">
                    A Node.js process (premiere-pro-mcp) running on your machine that exposes {product.coreToolCount} structured tools via the Model Context Protocol. It translates tool calls into Premiere-compatible scripts and manages file-based communication.
                  </p>
                </div>
                <div className="rounded-xl border border-site-line bg-site-panel p-6">
                  <h3 className="text-lg font-semibold text-site-accent">The Premiere Connector</h3>
                  <p className="mt-2 leading-7 text-site-muted">
                    A CEP plugin running inside Adobe Premiere Pro that polls for command files in a private temp directory, executes them via Premiere&apos;s ExtendScript API, and writes structured JSON results back.
                  </p>
                </div>
              </div>
            </section>

            <section className="border-b border-site-line py-12" aria-labelledby="workflow-heading">
              <h2 id="workflow-heading" className="text-3xl font-semibold">
                Step-by-step workflow
              </h2>
              <p className="mt-5 leading-8 text-site-muted">
                Here&apos;s what happens when you ask your AI assistant to edit something in Premiere Pro:
              </p>
              <div className="mt-8 space-y-6">
                {workflowSteps.map((step) => (
                  <div key={step.number} className="flex gap-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-site-accent/10 font-bold text-site-accent">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-site-text">{step.title}</h3>
                      <p className="mt-2 leading-7 text-site-muted">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border-b border-site-line py-12" aria-labelledby="ipc-heading">
              <h2 id="ipc-heading" className="text-3xl font-semibold">
                File-based IPC (Inter-Process Communication)
              </h2>
              <p className="mt-5 leading-8 text-site-muted">
                Premiere Pro MCP uses a file-based bridge instead of network sockets or HTTP:
              </p>
              <ul className="mt-6 space-y-3">
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    The MCP server writes command files to a <strong>private temp directory</strong> (mode 0700, user-owned) with unique IDs.
                  </span>
                </li>
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    The CEP connector polls this directory (typically every 100ms) and executes any new command files it finds.
                  </span>
                </li>
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    After execution, the connector writes a <strong>JSON result file</strong> back to the same directory.
                  </span>
                </li>
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    The MCP server polls for the result file, reads it, verifies the outcome, and returns structured data to the AI.
                  </span>
                </li>
              </ul>
              <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-5">
                <p className="text-sm leading-6 text-site-muted">
                  <span className="font-semibold text-amber-200">Why files instead of HTTP?</span> File-based IPC avoids exposing Premiere Pro to network connections and keeps all communication inspectable on disk. It also works across user sessions and survives Premiere Pro restarts.
                </p>
              </div>
            </section>

            <section className="border-b border-site-line py-12" aria-labelledby="security-heading">
              <h2 id="security-heading" className="text-3xl font-semibold">
                Security & privacy model
              </h2>
              <p className="mt-5 leading-8 text-site-muted">
                Premiere Pro MCP is designed with security and privacy as first principles:
              </p>
              <div className="mt-8 space-y-6">
                {securityPrinciples.map((principle) => (
                  <div key={principle.title} className="rounded-xl border border-site-line bg-site-panel p-6">
                    <div className="flex items-start gap-4">
                      <principle.icon className="h-6 w-6 shrink-0 text-site-accent" strokeWidth={1.5} />
                      <div>
                        <h3 className="text-lg font-semibold text-site-text">{principle.title}</h3>
                        <p className="mt-2 leading-7 text-site-muted">{principle.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-8 leading-8 text-site-muted">
                The default capability profile enables <code className="rounded bg-site-raised px-2 py-1 text-site-accent">inspect</code>, <code className="rounded bg-site-raised px-2 py-1 text-site-accent">edit</code>, <code className="rounded bg-site-raised px-2 py-1 text-site-accent">export</code>, and <code className="rounded bg-site-raised px-2 py-1 text-site-accent">filesystem</code> capabilities. Dangerous capabilities like <code className="rounded bg-site-raised px-2 py-1 text-site-accent">unsafe-script</code> (raw ExtendScript execution) are disabled by default.
              </p>
            </section>

            <section className="border-b border-site-line py-12" aria-labelledby="compatibility-heading">
              <h2 id="compatibility-heading" className="text-3xl font-semibold">
                Compatibility: CEP vs UXP
              </h2>
              <p className="mt-5 leading-8 text-site-muted">
                Premiere Pro MCP supports two connector types:
              </p>
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-site-line bg-site-panel p-6">
                  <h3 className="text-lg font-semibold text-site-accent">CEP (Default)</h3>
                  <p className="mt-2 leading-7 text-site-muted">
                    The signed CEP connector is the default and production route for Premiere Pro {product.premiereCompatibility} on macOS and Windows. It uses Adobe&apos;s ExtendScript API and the QE DOM (undocumented, but widely used).
                  </p>
                </div>
                <div className="rounded-xl border border-site-line bg-site-panel p-6">
                  <h3 className="text-lg font-semibold text-site-accent">UXP (Preview)</h3>
                  <p className="mt-2 leading-7 text-site-muted">
                    The UXP bridge adds capability-gated workflows for Premiere {product.uxpMinimumVersion}+ hosts using documented Premiere UXP APIs. It&apos;s not yet the default installer or a replacement for CEP. UXP tools honor runtime capability probes and never fall back to CEP or undocumented APIs.
                  </p>
                </div>
              </div>
            </section>

            <section className="border-b border-site-line py-12" aria-labelledby="diagnostics-heading">
              <h2 id="diagnostics-heading" className="text-3xl font-semibold">
                Diagnostics & troubleshooting
              </h2>
              <p className="mt-5 leading-8 text-site-muted">
                Premiere Pro MCP includes built-in diagnostics to help debug connection issues:
              </p>
              <ul className="mt-6 space-y-3">
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    <strong className="text-site-text">Automatic bridge startup:</strong> The CEP bridge creates its temp directory and starts polling when Premiere Pro activates.
                  </span>
                </li>
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    <strong className="text-site-text">Heartbeat checks:</strong> In-flight heartbeats help distinguish an open Premiere dialog (modal stall) from a disconnected bridge.
                  </span>
                </li>
                <li className="flex gap-3 leading-7 text-site-detail">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-site-accent" />
                  <span>
                    <strong className="text-site-text">Connection verification:</strong> The safe first prompt (<code className="rounded bg-site-raised px-2 py-1 text-site-accent">{safeFirstPrompt}</code>) runs a connection check without making any edits.
                  </span>
                </li>
              </ul>
              <Link
                href="/docs/troubleshooting/"
                className="mt-6 inline-flex items-center gap-2 font-medium text-site-accent hover:text-site-text"
              >
                View full troubleshooting guide <ArrowRight className="h-4 w-4" />
              </Link>
            </section>

            <section className="py-12" aria-labelledby="learn-more-heading">
              <h2 id="learn-more-heading" className="text-3xl font-semibold">
                Learn more
              </h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <Link
                  href="/docs/"
                  className="rounded-xl border border-site-line bg-site-panel p-6 transition-colors hover:border-site-accent"
                >
                  <h3 className="text-lg font-semibold text-site-accent">Installation guide</h3>
                  <p className="mt-2 text-sm leading-6 text-site-muted">
                    Step-by-step setup instructions for Claude Desktop, Cursor, and other AI clients.
                  </p>
                </Link>
                <Link
                  href="/tools/"
                  className="rounded-xl border border-site-line bg-site-panel p-6 transition-colors hover:border-site-accent"
                >
                  <h3 className="text-lg font-semibold text-site-accent">Tool reference</h3>
                  <p className="mt-2 text-sm leading-6 text-site-muted">
                    Browse all {product.coreToolCount} tools, their parameters, and availability by capability.
                  </p>
                </Link>
                <Link
                  href="/what-is-premiere-pro-mcp/"
                  className="rounded-xl border border-site-line bg-site-panel p-6 transition-colors hover:border-site-accent"
                >
                  <h3 className="text-lg font-semibold text-site-accent">What is Premiere Pro MCP?</h3>
                  <p className="mt-2 text-sm leading-6 text-site-muted">
                    A beginner-friendly introduction to what Premiere Pro MCP is and who it&apos;s for.
                  </p>
                </Link>
                <a
                  href="https://github.com/leancoderkavy/premiere-pro-mcp#readme"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-site-line bg-site-panel p-6 transition-colors hover:border-site-accent"
                >
                  <h3 className="text-lg font-semibold text-site-accent">Source code & README</h3>
                  <p className="mt-2 text-sm leading-6 text-site-muted">
                    View the full source code, architecture docs, and contribution guidelines on GitHub.
                  </p>
                </a>
              </div>
            </section>
          </article>
        </main>
      </>
    </PublicPage>
  )
}
