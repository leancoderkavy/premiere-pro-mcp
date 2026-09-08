import type { Metadata } from "next"
import Link from "next/link"
import { TrackedLink } from "@/components/ui/tracked-link"
import { WorkflowKitActions } from "@/components/workflow-kit-actions"
import kits from "@/lib/workflow-kits.json"
import { product } from "@/lib/product"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Workflow Starter Kit: Prompts and Sample Media",
  description:
    "Try a sequence check, a review-frame export, or a product-spot preview with synthetic sample media, explicit steps, and copyable Premiere MCP prompts.",
  alternates: { canonical: "/workflows/" },
  twitter: {
    card: "summary_large_image",
    title: "Try a Premiere MCP workflow",
    description: "Three evaluation recipes, synthetic media, and setup help. Free download; no email required.",
    images: ["/marketing/premiere-pro-mcp-social-square-v1.png"],
  },
  openGraph: {
    title: "Try a Premiere MCP workflow",
    description:
      "Three evaluation recipes, synthetic media, and setup help. Free download; no email required.",
    url: "/workflows/",
    type: "website",
  },
}

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Premiere Pro MCP workflow starter kit",
  url: "https://premiere-pro-mcp.com/workflows/",
  description:
    "Evaluation recipes and synthetic media. Licensed-host verification is pending.",
  hasPart: kits.map((kit) => ({
    "@type": "CreativeWork",
    name: kit.title,
    description: kit.summary,
    url: `https://premiere-pro-mcp.com/workflows/#${kit.id}`,
  })),
}

export default function WorkflowsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main
        id="main-content"
        className="min-h-screen bg-black px-5 py-10 text-zinc-100 sm:py-16"
      >
        <div className="mx-auto max-w-5xl">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap gap-x-3 text-sm text-zinc-300"
          >
            <Link
              className="inline-flex min-h-11 items-center hover:text-white"
              href="/"
            >
              MCP for Adobe Premiere Pro
            </Link>
            <span className="inline-flex items-center" aria-hidden="true">
              /
            </span>
            <span className="inline-flex items-center">
              Workflow starter kit
            </span>
          </nav>
          <header className="border-b border-zinc-800 pb-10 pt-9">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-violet-200">
              Sample media · three recipes · your assistant
            </p>
            <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
              Try a Premiere workflow you can inspect.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">
              Check a sequence, prepare review frames, or preview an assembly.
              Start with synthetic clips and a disposable project before using
              your own edit.
            </p>
            <TrackedLink
              href="/downloads/premiere-workflow-starter-kit.zip"
              download
              trackingLocation="workflow_kit"
              trackingDestination="starter_kit_download"
              className="mt-7 inline-flex min-h-12 items-center justify-center rounded-md bg-violet-200 px-6 py-3 font-semibold text-black hover:bg-white"
            >
              Download starter kit
            </TrackedLink>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Free ZIP · no email · two synthetic MP4 clips, a caption sample,
              instructions, and evaluation prompts.
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Requires Premiere, a compatible AI client, and the local
              connector. This is an evaluation kit, not a recorded demo or a
              host-verified Premiere project. Media files are generated
              fixtures.
            </p>
          </header>
          <section
            className="grid gap-5 border-b border-zinc-800 py-9 md:grid-cols-3"
            aria-label="Get started"
          >
            {[
              [
                "01",
                "Connect your assistant",
                "Install the server and separate Premiere connector, then run the read-only connection check.",
                "/#install",
                "Installation steps",
              ],
              [
                "02",
                "Make a test sequence",
                "Import the two kit clips into a new disposable project. Follow one recipe below.",
                "#project-check",
                "Start with a project check",
              ],
              [
                "03",
                "Compare the result",
                "Use the checklist in the kit. Record failed and unsupported checks as well as successes.",
                "/docs/troubleshooting/",
                "Setup and recovery help",
              ],
            ].map(([number, title, text, href, label]) => (
              <div key={number}>
                <p className="font-mono text-sm text-violet-200">{number}</p>
                <h2 className="mt-2 text-lg font-semibold">{title}</h2>
                <p className="mt-3 leading-7 text-zinc-300">{text}</p>
                <Link
                  href={href}
                  className="mt-2 inline-flex min-h-11 items-center text-violet-200 underline underline-offset-4"
                >
                  {label}
                </Link>
              </div>
            ))}
          </section>
          <div className="divide-y divide-zinc-800">
            {kits.map((kit, index) => (
              <section
                key={kit.id}
                id={kit.id}
                className="scroll-mt-8 py-10 sm:py-14"
              >
                <div className="grid gap-7 md:grid-cols-[1fr_1.1fr]">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-wider text-violet-200">
                      Recipe {index + 1}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                      {kit.title}
                    </h2>
                    <p className="mt-4 leading-7 text-zinc-300">
                      {kit.summary}
                    </p>
                    <p className="mt-4 leading-7">
                      <strong>Expected output:</strong> {kit.output}
                    </p>
                    <p className="mt-4 text-sm leading-6 text-zinc-400">
                      {kit.boundary}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">
                      {kit.availability}
                    </p>
                    <Link
                      href={kit.guide}
                      className="mt-3 inline-flex min-h-11 items-center text-violet-200 underline underline-offset-4"
                    >
                      Read the workflow guide
                    </Link>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
                    <ol className="list-decimal space-y-4 pl-5 leading-7 text-zinc-300">
                      {kit.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <WorkflowKitActions id={kit.id} prompt={kit.prompt} />
                  </div>
                </div>
              </section>
            ))}
          </div>
          <section className="rounded-xl border border-zinc-700 p-6 sm:p-8">
            <h2 className="text-2xl font-semibold">
              Make the next attempt easier.
            </h2>
            <p className="mt-4 max-w-3xl leading-7 text-zinc-300">
              Share the public recipe link or contribute an improved checklist.
              Keep footage, project names, paths, transcripts, and tokens out of
              public reports. A copied prompt or download is not a completed
              workflow.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6">
              <Link
                href="/facts/"
                className="inline-flex min-h-11 items-center text-violet-200 underline"
              >
                Release facts and compatibility
              </Link>
              <a
                href={`${product.links.repository}/blob/main/docs/workflow-proof-runbook.md`}
                className="inline-flex min-h-11 items-center text-violet-200 underline"
              >
                Host test runbook
              </a>
              <a
                href={`${product.links.repository}/discussions`}
                className="inline-flex min-h-11 items-center text-violet-200 underline"
              >
                Community discussions
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  )
}
