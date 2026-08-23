import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Premiere Pro MCP handles local project data, operational telemetry, and website analytics.",
  alternates: { canonical: "/privacy/" },
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-black px-5 py-16 text-zinc-300">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-purple-300 hover:text-purple-200">← Back to Premiere Pro MCP</Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-white">Privacy Policy</h1>
        <p className="mt-3 text-sm text-zinc-500">Last updated: August 22, 2026</p>

        <div className="mt-10 space-y-9 leading-7">
          <section>
            <h2 className="text-xl font-semibold text-white">Overview</h2>
            <p className="mt-3">Premiere Pro MCP is an open-source, local-first connector. In the recommended setup, the MCP server and Adobe connector run on your computer. Project files, prompts, media, timelines, and exports are not automatically uploaded to us. Your chosen AI assistant and any remote MCP host have their own privacy practices.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">MCP operational telemetry</h2>
            <p className="mt-3">Telemetry is disabled when the server has no <code>POSTHOG_API_KEY</code>. When an operator enables it, the server may send PostHog operational events such as connection attempts, request or tool names, outcomes, status codes, duration, server version, environment, region, transport, and an operator-provided or generated server identifier.</p>
            <p className="mt-3">The telemetry implementation excludes authentication tokens, IP-address properties, prompts and MCP arguments, project paths, media names, tool results, and person profiles. Operators of separately hosted instances control their own configuration and retention.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">Website analytics</h2>
            <p className="mt-3">The public website loads Google Analytics after the page is interactive and idle, with IP anonymization. It records page views and bounded setup interactions such as the route, selected assistant, download action, or help panel opened. These events are designed not to include prompts, project details, media names, or file paths. Google may process device, browser, approximate location, and interaction information under its own policies.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">Cookies and choices</h2>
            <p className="mt-3">Analytics services may use cookies or similar browser storage. You can block or clear them using your browser controls or content-blocking tools. Local MCP operators can keep operational telemetry off by leaving <code>POSTHOG_API_KEY</code> unset.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">Retention and sharing</h2>
            <p className="mt-3">We use collected analytics only to understand reliability, adoption, and setup problems. We do not sell personal information. Analytics providers process data on our behalf under their terms and retention settings. Local project and media data remains subject to the settings of your computer, Adobe software, AI assistant, and any services you choose.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">Requests and contact</h2>
            <p className="mt-3">To ask a privacy question or request access or deletion where applicable, email <a className="text-purple-300 hover:text-purple-200" href="mailto:leancoderk@gmail.com">leancoderk@gmail.com</a>. Because analytics identifiers are not connected to an account, we may need information from you to locate a record and may be unable to identify anonymous data.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-white">Changes</h2>
            <p className="mt-3">We may update this policy when the product or its data practices change. The date above identifies the current version.</p>
          </section>
        </div>
      </article>
    </main>
  )
}
