import { PublicPage } from "@/components/site/public-page"
import type { Metadata } from "next"
import { HomeLink } from "@/components/ui/home-link"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How MCP for Adobe Premiere Pro handles local project data, operational telemetry, and website analytics.",
  alternates: { canonical: "/privacy/" },
}

export default function PrivacyPage() {
  return (
    <PublicPage>
    <main id="main-content" className="min-h-screen bg-site-bg px-5 py-16 text-site-detail">
      <article className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb"><HomeLink>MCP for Adobe Premiere Pro</HomeLink> <span aria-hidden="true">/</span> Privacy</nav>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-site-text">Privacy Policy</h1>
        <p className="mt-3 text-sm text-site-muted">Last updated: September 15, 2026</p>

        <div className="mt-10 space-y-9 leading-7">
          <section>
            <h2 className="text-xl font-semibold text-site-text">Overview</h2>
            <p className="mt-3">MCP for Adobe Premiere Pro is an open-source, local-first connector. In the recommended setup, the MCP server and Adobe connector run on your computer. Project files, prompts, media, timelines, and exports are not automatically uploaded to us. Your chosen AI assistant and any remote MCP host have their own privacy practices.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">MCP operational telemetry</h2>
            <p className="mt-3">Telemetry is disabled when the server has no <code>POSTHOG_API_KEY</code>. When an operator enables it, the server may send PostHog operational events such as connection attempts, request or tool names, outcomes, status codes, duration, server version, environment, region, transport, and an operator-provided or generated server identifier.</p>
            <p className="mt-3">The telemetry implementation excludes authentication tokens, IP-address properties, prompts and MCP arguments, project paths, media names, tool results, and person profiles. Operators of separately hosted instances control their own configuration and retention.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">Website analytics</h2>
            <p className="mt-3">The public website loads Google Analytics and PostHog after the page is interactive and idle. Google Analytics uses IP anonymization. PostHog is configured without autocapture, session replay, or person profiles, and does not include IP-address properties. Both record page views and bounded setup interactions such as the route, selected assistant, download action, or help panel opened. These events are designed not to include prompts, project details, media names, or file paths. Analytics providers may process device, browser, approximate location, and interaction information under their own policies.</p>
            <p className="mt-3">When a homepage experiment is enabled, PostHog assigns an anonymous visitor to a page design. After that design is displayed, the website records the variant and a limited set of setup actions, including download clicks and successful copies of the safe connection prompt. The prompt text, your clipboard contents, project data, footage, IP-address properties, and person profiles are not included in these experiment events. Download clicks measure interest in setup; they do not establish that installation or a Premiere connection succeeded.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">Cookies and choices</h2>
            <p className="mt-3">Analytics services may use cookies or similar browser storage. You can block or clear them using your browser controls or content-blocking tools. PostHog is not loaded when the browser sends Do Not Track or Global Privacy Control. Local MCP operators can keep operational telemetry off by leaving <code>POSTHOG_API_KEY</code> unset.</p>
            <p className="mt-3">The homepage experiment uses a first-party, signed, HTTP-only cookie named <code>premiere_homepage_v1</code> to keep an anonymous visitor’s assignment consistent and connect subsequent setup actions to that exposure. It expires after 30 days without renewal. Website analytics and experimentation respect Do Not Track and Global Privacy Control signals. Direct design previews do not enter the experiment.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">Retention and sharing</h2>
            <p className="mt-3">We use collected analytics only to understand reliability, adoption, and setup problems. We do not sell personal information. Analytics providers process data on our behalf under their terms and retention settings. Local project and media data remains subject to the settings of your computer, Adobe software, AI assistant, and any services you choose.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">Requests and contact</h2>
            <p className="mt-3">To ask a privacy question or request access or deletion where applicable, email <a className="text-site-accent hover:text-site-accent" href="mailto:leancoderk@gmail.com">leancoderk@gmail.com</a>. Because analytics identifiers are not connected to an account, we may need information from you to locate a record and may be unable to identify anonymous data.</p>
          </section>
          <section>
            <h2 className="text-xl font-semibold text-site-text">Changes</h2>
            <p className="mt-3">We may update this policy when the product or its data practices change. The date above identifies the current version.</p>
          </section>
        </div>
      </article>
    </main>
    </PublicPage>
  )
}
