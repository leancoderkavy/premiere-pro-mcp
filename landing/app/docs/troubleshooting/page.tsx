import type { Metadata } from "next"
import Link from "next/link"
import { product, safeFirstPrompt } from "@/lib/product"

export const metadata: Metadata = {
  title: "Premiere Pro MCP Not Connecting? Setup and Recovery",
  description:
    "Diagnose a missing Premiere connector, unavailable MCP tools, missing active sequence, or unsupported workflow. Separate local setup from a verified Premiere connection.",
  alternates: { canonical: "/docs/troubleshooting/" },
  twitter: {
    card: "summary_large_image",
    title: "Premiere MCP setup and recovery",
    description: "Find the failing setup step and run a read-only check before retrying.",
    images: ["/marketing/premiere-pro-mcp-social-square-v1.png"],
  },
  openGraph: {
    title: "Premiere MCP setup and recovery",
    description:
      "Find the failing setup step and run a read-only check before retrying.",
    url: "/docs/troubleshooting/",
    type: "article",
  },
}
const problems = [
  {
    title: "My assistant cannot see Premiere tools",
    steps: [
      "Confirm that the MCP server was installed in the same client you are using. The Claude Desktop bundle and the Premiere connector are separate installations.",
      "Restart the client after configuration changes. For npm setup, confirm Node.js meets the documented minimum and the configured executable resolves.",
      "For protocol discovery failures, follow the documented legacy-mode recovery in the README. Do not paste arbitrary configuration from an unrelated client.",
    ],
  },
  {
    title: "The Premiere panel is missing",
    steps: [
      "Check that you installed the Premiere connector as well as the AI-client server. Installing the Claude bundle alone does not add a Premiere panel.",
      "Fully quit and restart Premiere. For the default CEP route, look under Window > Extensions for MCP for Adobe Premiere Pro.",
      "Review the matching release instructions for your OS and connector. UXP and CEP installation steps differ; do not switch bridges simply because one tool is unavailable.",
    ],
  },
  {
    title: "The panel is running, but the connection check fails",
    steps: [
      "Keep Premiere, the client, and the server on the same computer for the recommended route. Open a disposable project and select a sequence.",
      "Run the read-only connection check again and use its reported missing state. A running panel or successful local doctor check does not establish a live connection.",
      "Do not point the client at the public hosted endpoint as a shortcut. It requires authentication and does not automatically connect to your desktop.",
    ],
  },
  {
    title: "A recipe asks for a missing capability",
    steps: [
      "Stop the recipe. Inspect the actual tools available in this session and compare your package and connector versions with the release notes.",
      "The source catalog can include unreleased work. UXP operations also require a compatible connected host and advertised capabilities.",
      "Report the bounded error code, OS, client, and version if you need help. Do not bypass the capability check or substitute an arbitrary script.",
    ],
  },
  {
    title: "An operation failed or its result is uncertain",
    steps: [
      "Inspect the disposable project before retrying. A partial or unverified result may require human recovery; it is not a successful completion.",
      "Recapture current targets before any later preview. Keep the operation's normal confirmation and revision checks.",
      "For frame exports, inspect the actual files. For an edit, check the timeline, playback, and rendered output separately. Use Premiere's normal Undo or restore your test copy when appropriate.",
    ],
  },
]
export default function TroubleshootingPage() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-black px-5 py-12 text-zinc-100"
    >
      <article className="mx-auto max-w-3xl">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap gap-3 text-sm text-zinc-300"
        >
          <Link className="inline-flex min-h-11 items-center" href="/">
            MCP for Adobe Premiere Pro
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-violet-200"
            href="/workflows/"
          >
            Workflow starter kit
          </Link>
        </nav>
        <header className="py-9">
          <p className="text-sm text-violet-200">Setup and recovery</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            Premiere Pro MCP not connecting?
          </h1>
          <p className="mt-5 text-lg leading-8 text-zinc-300">
            Find the failing step before trying another edit. Start with a
            disposable project and the read-only check.
          </p>
          <p className="mt-5 break-words rounded-lg border border-zinc-700 p-5 font-mono text-sm leading-7">
            {safeFirstPrompt}
          </p>
        </header>
        <div className="divide-y divide-zinc-800">
          {problems.map((problem) => (
            <section key={problem.title} className="py-8">
              <h2 className="text-2xl font-semibold">{problem.title}</h2>
              <ol className="mt-5 list-decimal space-y-4 pl-5 leading-7 text-zinc-300">
                {problem.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <section className="mt-6 rounded-xl border border-zinc-700 p-6">
          <h2 className="text-2xl font-semibold">Retry a bounded workflow</h2>
          <p className="mt-4 leading-7 text-zinc-300">
            Once the connection reports ready, start with the sequence check. Do
            not treat readiness as proof that an edit completed.
          </p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link
              href="/workflows/#project-check"
              className="inline-flex min-h-12 items-center rounded-md bg-violet-200 px-5 font-semibold text-black"
            >
              Try the project check
            </Link>
            <a
              href={product.links.readme}
              className="inline-flex min-h-12 items-center text-violet-200 underline"
            >
              Installation reference
            </a>
            <a
              href={product.links.issues}
              className="inline-flex min-h-12 items-center text-violet-200 underline"
            >
              Report a setup issue
            </a>
          </div>
        </section>
      </article>
    </main>
  )
}
