import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, ArrowUpRight, Github, Package } from "lucide-react"
import { product } from "@/lib/product"

const releases = [
  {
    version: "1.12.1",
    date: "2026-08-22",
    label: "Analytics CSP compatibility",
    groups: [
      {
        title: "Fixed",
        items: [
          "Allowed Google Analytics collection requests to www.google.com in the restrictive Content Security Policy, matching the current Google tag client.",
        ],
      },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-08-22",
    label: "Reviewed editorial workflow controls",
    groups: [
      {
        title: "Added",
        items: [
          "Added local-first editorial plans for organization and platform cutdowns, with previewable recommendations and a guarded UXP organization apply route.",
          "Added structured UXP readback requirements, a licensed-host validation runbook, and product-claim drift checks.",
        ],
      },
      {
        title: "Safety",
        items: [
          "Organization plans now require an exact server-issued plan and opaque preview token; changed plans and duplicate source guards are rejected before a UXP mutation.",
          "Automated contracts verify response shape, but real licensed-Premiere host validation remains a separate evidence gate.",
        ],
      },
    ],
  },
  {
    version: "1.11.5",
    date: "2026-08-19",
    label: "MCP safety and interoperability research",
    groups: [
      {
        title: "Changed",
        items: [
          "Published ten research-backed implementation recommendations for subscription streams, contextual completions, workspace boundaries, resource annotations and canonical URIs, prompt-injection defenses, end-to-end health checks, C2PA inspection, UXP external-launch safeguards, and keyframe verification.",
        ],
      },
      {
        title: "Validation",
        items: [
          "The recommendations are documented planning work; implementation and licensed-Premiere host confirmation remain explicit follow-up gates.",
        ],
      },
    ],
  },
  {
    version: "1.11.4",
    date: "2026-08-19",
    label: "Claude Desktop UXP token injection",
    groups: [
      {
        title: "Fixed",
        items: [
          "The Claude Desktop MCPB now prompts for the sensitive Premiere UXP token and injects it into the bundled server process so the authenticated loopback listener starts reliably.",
        ],
      },
      {
        title: "Validation",
        items: [
          "MCPB schema and distribution validation now fail if the token field or environment mapping is removed.",
        ],
      },
    ],
  },
  {
    version: "1.11.3",
    date: "2026-08-18",
    label: "Premiere 26.3 UXP connection and transcript planning",
    groups: [
      {
        title: "Added",
        items: [
          "Added a revision-locked transcript rough-cut planner that maps selected source ranges to verified 1x sequence placements and emits descending, non-mutating cut instructions.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Updated the UXP network manifest declaration for Premiere Pro 26.3 compatibility while retaining exact loopback-only bridge validation at runtime.",
        ],
      },
      {
        title: "Validation",
        items: [
          "Automated tests and cross-platform package gates pass; exact-package confirmation in a licensed Premiere host remains separate.",
        ],
      },
    ],
  },
  {
    version: "1.11.2",
    date: "2026-08-18",
    label: "Fail-closed Premiere 26.x timeline mutations",
    groups: [
      {
        title: "Added",
        items: [
          "Added durable local project-context capture, bounded retrieval, enrichment, and non-mutating edit-plan scaffolds with independent source and timeline revisions.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Trim and split now verify visible timeline geometry; track creation and overwrite placement verify exact postconditions instead of accepting silent no-ops.",
          "Effect removal now preflights Component.remove support, including safe handling for unsupported Essential Sound Amplify components.",
        ],
      },
      {
        title: "Validation",
        items: [
          "Automated CEP/QE contract coverage is included; licensed Premiere Pro 26.x host confirmation remains a separate gate.",
        ],
      },
    ],
  },
  {
    version: "1.11.1",
    date: "2026-08-16",
    label: "Remote static-route stability hotfix",
    groups: [
      {
        title: "Fixed",
        items: [
          "Extensionless exported routes now resolve to their index file instead of streaming a directory and restarting the Linux HTTP process with EISDIR.",
          "Static candidates must remain inside the landing root and resolve to regular files; asynchronous read failures no longer terminate the server.",
        ],
      },
      {
        title: "Validation",
        items: [
          "Regression tests cover extensionless routes and read-stream failures; real Premiere host verification remains a separate gate.",
        ],
      },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-16",
    label: "Evidence-backed third-wave UXP workflows",
    groups: [
      {
        title: "Added",
        items: [
          "Added eight capability-gated UXP tools for host events, readiness, project sessions, growing media, checkpoints, media health, track state, and source trim and framing.",
          "Added a generated supported-actions catalog and schema-backed hybrid benchmark evidence gate.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Corrected clip-volume conversion from decibels to Premiere's normalized Level value and added readback and batch controls.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Expanded the connected surface to 328 tools and added bounded history, explicit confirmations, timeout budgets, and post-mutation readback.",
        ],
      },
      {
        title: "Validation",
        items: [
          "Automated tests, coverage, generated-document checks, and package validation pass; real Premiere host verification remains a separate gate.",
        ],
      },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-16",
    label: "Stable, bounded UXP workflow expansion",
    groups: [
      {
        title: "Added",
        items: [
          "Added 21 consolidated, capability-gated UXP tools, expanding the connected surface from 297 to 318 tools.",
          "Added native workflows for effects, selections, scene detection, proxies, relinking, metadata, color, Source Monitor, storage, project organization, keyframes, timeline edits, sequences, and encoding.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Bounded project traversal, grouped compatible Adobe actions into transactions, and added stale-state guards, replay protection, and readback evidence.",
          "Replaced UXP filesystem full access with an operator-selected workspace while retaining CEP as the production-compatible bridge.",
        ],
      },
      {
        title: "Validation",
        items: [
          "Automated unit, contract, distribution, and coverage gates exercise the expanded surface; real Premiere host verification and latency benchmarking remain pending.",
        ],
      },
    ],
  },
  {
    version: "1.9.3",
    date: "2026-08-12",
    label: "Focused release overview and repository assets",
    groups: [
      {
        title: "Added",
        items: [
          "Added the MCP for Adobe Premiere Pro cinematic intro video to the landing assets.",
          "Added the dated security best-practices audit report for repository reference.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Simplified the README release overview to show only the latest release and link to the complete release notes.",
        ],
      },
      {
        title: "Security",
        items: [
          "Updated the landing build's transitive nanoid dependency to a patched version.",
        ],
      },
    ],
  },
  {
    version: "1.9.2",
    date: "2026-08-04",
    label: "Adobe Marketplace compatibility and privacy disclosure",
    groups: [
      {
        title: "Fixed",
        items: [
          "Changed the CEP Premiere host declaration to a minimum-only supported version for Adobe Developer Distribution compatibility.",
        ],
      },
      {
        title: "Added",
        items: [
          "Published a clear privacy policy for local media processing, optional MCP operational telemetry, website analytics, retention, and user choices.",
        ],
      },
    ],
  },
  {
    version: "1.9.1",
    date: "2026-08-02",
    label: "Production HTTP security headers",
    groups: [
      {
        title: "Security",
        items: [
          "Added CSP, HSTS, MIME sniffing protection, frame denial, bounded permissions, and explicit referrer and cross-origin policies to every HTTP response.",
          "Restricted browser network destinations to the application and configured analytics endpoints.",
        ],
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-02",
    label: "Nontechnical onboarding and safe connection recovery",
    groups: [
      {
        title: "Added",
        items: [
          "Read-only connection verification, human-readable doctor diagnostics, sanitized support bundles, and an accessible in-panel Connection Center.",
          "Deterministic UXP CCX distribution plus native Windows and macOS CEP installer pipelines with fail-closed production signing gates.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Reworked setup around the editor's AI assistant, with Claude Desktop first and npm or manual JSON configuration under Advanced.",
          "Aligned the catalog at 280 registered tools, 278 under the default profile, and 297 with the 19 capability-gated UXP tools connected.",
        ],
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-08-01",
    label: "Native transcript edit planning",
    groups: [
      {
        title: "Added",
        items: [
          "Three read-only, capability-gated UXP tools for native transcript export, native transcript search, and revision-locked edit previews.",
          "Deterministic transcript revisions and confirmation tokens so edit plans cannot be applied to a regenerated transcript.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Expanded the connected UXP surface from 16 to 19 tools without changing the 279 core-tool surface.",
          "Automatic transcript-to-timeline application remains unavailable until a real Premiere host validates documented source-to-sequence reconstruction.",
        ],
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-08-01",
    label: "Adobe Premiere Pro 26.3 UXP API coverage",
    groups: [
      {
        title: "Added",
        items: [
          "Six capability-gated UXP tools for track rename, subclip creation, stable marker IDs, Source Monitor positioning, transcript detection, and AAF export.",
          "Adobe 26.3 declarations, lint rules, coverage metadata, and contract tests for the supported API surface.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Expanded the connected UXP surface from 10 to 16 tools while preserving explicit host capability and verification boundaries.",
          "Separated the stable Adobe 26.3 baseline from beta-only 26.5 declarations.",
        ],
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-07-31",
    label: "Capability-aware UXP workflows and verified project creation",
    groups: [
      {
        title: "Added",
        items: [
          "Capability-aware UXP workflows for project inspection and saves, preset sequences, OTIO/FCP XML interchange, transcript languages, Object Mask detection, and Adobe Media Encoder controls.",
          "Operation-ID replay protection and explicit verification outcomes for supported UXP mutations.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Project creation now verifies that Premiere opened the requested project before reporting success.",
          "Updated package, panel, client-plugin, and landing metadata for v1.6.0.",
        ],
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-30",
    label: "Verified structural edits and silence detection",
    groups: [
      {
        title: "Added",
        items: [
          "Local source-media silence detection powered by FFmpeg, with Docker and installation guidance.",
          "Anonymous, opt-out usage telemetry and an expanded editorial product experience.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Expanded the surface to 279 tools while advertising only tools permitted by the active capability profile.",
          "Documented remote media-path constraints and the 277 tools available under the default profile.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Structural timeline operations now verify applied edits instead of reporting unverified success.",
          "Server metadata now reads the package version, and HTTP and filesystem CodeQL findings are resolved.",
        ],
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-26",
    label: "Transport, diagnostics, and distributions",
    groups: [
      {
        title: "Added",
        items: [
          "In-panel connector update discovery and trusted downloads from GitHub Releases.",
          "Authenticated MCP-to-UXP WebSocket transport, transcript and caption inspection, event-driven state reporting, operation semantics, and supported video-transition workflows.",
          "Recovery diagnostics, export verification, audio/video inspection, capability reporting, and collaboration and AI feature eligibility discovery.",
          "Installable Codex, Claude Code, and Claude Desktop distributions.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Expanded the MCP surface to 278 tools and aligned the documentation, plugin metadata, and distributions.",
          "Added automated signed CEP connector assets and Claude Desktop bundles to GitHub releases.",
        ],
      },
    ],
  },
  {
    version: "1.3.1",
    date: "2026-07-25",
    label: "Frame-rate reliability",
    groups: [
      {
        title: "Fixed",
        items: [
          "Corrected set_sequence_frame_rate tick conversion and added verification for the resulting sequence frame rate.",
        ],
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-25",
    label: "Signed Windows connector",
    groups: [
      {
        title: "Added",
        items: [
          "A signed CEP ZXP workflow for Windows releases.",
          "A --diagnose-cep command for connector installation diagnostics.",
        ],
      },
      {
        title: "Changed",
        items: [
          "Upgraded to TypeScript 7, Vitest 4, Zod 4, MCP SDK 1.29, and Next.js 16.2.12.",
          "Raised the Node.js floor to 20.19 and moved continuous integration to Node.js 24.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Aligned explicit Node types and Zod 4 schema conversion.",
          "Resolved the signed CEP Windows installation issue tracked in #36.",
        ],
      },
    ],
  },
  {
    version: "1.2.3",
    date: "2026-07-23",
    label: "Package maintenance",
    groups: [
      {
        title: "Changed",
        items: [
          "Refined npm and GitHub package metadata.",
          "Added Dependabot configuration for routine dependency updates.",
        ],
      },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-07-23",
    label: "Trusted publishing",
    groups: [
      {
        title: "Changed",
        items: [
          "Updated repository links and added trusted npm publishing workflows.",
        ],
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-21",
    label: "Capability discovery",
    groups: [
      {
        title: "Added",
        items: [
          "A get_capabilities tool and capability profiles for safer feature discovery.",
          "Continuous integration coverage for the supported runtime matrix.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Improved audio writes, keyframes, editing verification, installer behavior, and runtime performance.",
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-20",
    label: "Structured editing",
    groups: [
      {
        title: "Added",
        items: [
          "Edit plans, structured operation results, capability reporting, and a UXP preview.",
          "Stronger validation across editing and export operations.",
        ],
      },
    ],
  },
  {
    version: "1.1.7",
    date: "2026-07-20",
    label: "Connector accessibility",
    groups: [
      {
        title: "Changed",
        items: [
          "Redesigned the CEP panel with clearer status, setup guidance, and accessibility improvements.",
        ],
      },
    ],
  },
  {
    version: "1.1.6",
    date: "2026-07-20",
    label: "Capture and diagnostics",
    groups: [
      {
        title: "Fixed",
        items: [
          "Improved second-based frame capture, Windows CEP debugging, and connector version-drift detection.",
        ],
      },
    ],
  },
  {
    version: "1.1.2",
    date: "2026-07-11",
    label: "Expanded Premiere bridge",
    groups: [
      {
        title: "Added",
        items: [
          "CEP 12 bridge support, markers, proxies, presets, frame export, and six additional editing tools.",
          "Broader project, sequence, media, and export workflows with clearer operation notes.",
        ],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2025-02-26",
    label: "Initial release",
    groups: [
      {
        title: "Added",
        items: [
          "The first public release with 269 tools spanning timeline editing, effects, color, keyframes, media management, and export.",
        ],
      },
    ],
  },
] as const

export const metadata: Metadata = {
  title: "Changelog | premiere-pro-mcp",
  description:
    "Release notes for premiere-pro-mcp, including new Premiere Pro automation tools, connector improvements, fixes, and compatibility updates.",
  alternates: {
    canonical: "https://premiere-pro-mcp.com/changelog/",
  },
  openGraph: {
    title: "premiere-pro-mcp changelog",
    description: "New tools, connector improvements, fixes, and compatibility updates.",
    url: "https://premiere-pro-mcp.com/changelog/",
    type: "website",
  },
}

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": "https://premiere-pro-mcp.com/changelog/#page",
      url: "https://premiere-pro-mcp.com/changelog/",
      name: "premiere-pro-mcp changelog",
      description:
        "Release notes for premiere-pro-mcp, including new tools, connector improvements, fixes, and compatibility updates.",
      dateModified: product.releaseDate,
      isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" },
      about: { "@id": "https://premiere-pro-mcp.com/#software" },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://premiere-pro-mcp.com/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Changelog",
          item: "https://premiere-pro-mcp.com/changelog/",
        },
      ],
    },
  ],
}

export default function ChangelogPage() {
  return (
    <main id="main-content" className="min-h-screen bg-black text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="border-b border-zinc-900">
        <nav
          className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"
          aria-label="Changelog navigation"
        >
          <Link href="/" className="flex items-center gap-3 text-sm font-semibold text-white">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-purple-400/30 bg-purple-500/15 font-mono text-sm text-purple-200">
              Pr
            </span>
            <span>premiere-pro-mcp</span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/docs/" className="hidden text-zinc-400 hover:text-white sm:block">
              Docs
            </Link>
            <a
              href="https://github.com/leancoderkavy/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-zinc-300 hover:text-white"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </div>
        </nav>
      </header>

      <section className="border-b border-zinc-900 px-5 py-16 md:py-24">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-purple-300">
                Release history
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-[-0.045em] text-white sm:text-6xl">
                Changelog
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
                What&apos;s new in premiere-pro-mcp—from editing tools and connector
                upgrades to reliability fixes.
              </p>
            </div>
            <div className="border-l border-purple-400/40 pl-5">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Latest release</p>
              <p className="mt-2 font-mono text-2xl text-white">v{product.version}</p>
              <time className="mt-1 block text-sm text-zinc-500" dateTime={product.releaseDate}>
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(`${product.releaseDate}T00:00:00Z`))}
              </time>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-12 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-20 lg:py-20">
        <aside className="min-w-0">
          <nav
            aria-label="Release navigation"
            className="flex max-w-full gap-2 overflow-x-auto pb-3 lg:sticky lg:top-8 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            <span className="mb-3 hidden text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600 lg:block">
              Versions
            </span>
            {releases.map((release) => (
              <a
                key={release.version}
                href={`#v${release.version.replaceAll(".", "-")}`}
                className="shrink-0 border border-zinc-800 px-3 py-2 font-mono text-xs text-zinc-500 transition-colors hover:border-purple-400/50 hover:text-purple-200 lg:border-0 lg:border-l lg:px-4 lg:py-1.5"
              >
                v{release.version}
              </a>
            ))}
          </nav>
        </aside>

        <div>
          {releases.map((release, index) => (
            <article
              key={release.version}
              id={`v${release.version.replaceAll(".", "-")}`}
              className="scroll-mt-8 border-t border-zinc-800 py-12 first:border-t-0 first:pt-0"
            >
              <div className="grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <div>
                  <p className="font-mono text-2xl font-medium text-white">v{release.version}</p>
                  <time dateTime={release.date} className="mt-2 block text-sm text-zinc-600">
                    {new Intl.DateTimeFormat("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${release.date}T00:00:00Z`))}
                  </time>
                  {index === 0 && (
                    <span className="mt-4 inline-flex rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-1 text-xs font-medium text-purple-200">
                      Latest
                    </span>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
                    {release.label}
                  </h2>
                  <div className="mt-8 space-y-8">
                    {release.groups.map((group) => (
                      <section key={group.title} aria-labelledby={`${release.version}-${group.title}`}>
                        <h3
                          id={`${release.version}-${group.title}`}
                          className="font-mono text-xs uppercase tracking-[0.18em] text-purple-300"
                        >
                          {group.title}
                        </h3>
                        <ul className="mt-3 space-y-3">
                          {group.items.map((item) => (
                            <li
                              key={item}
                              className="relative pl-5 text-[15px] leading-7 text-zinc-400 before:absolute before:left-0 before:top-[0.7rem] before:h-px before:w-2 before:bg-zinc-700"
                            >
                              {item}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                  <a
                    href={`https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v${release.version}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-8 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-white"
                  >
                    View release
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <footer className="border-t border-zinc-900 px-5 py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Ready to automate your next Premiere Pro edit?</p>
          <div className="flex gap-5">
            <a
              href="https://www.npmjs.com/package/premiere-pro-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-zinc-300 hover:text-white"
            >
              <Package className="h-4 w-4" />
              Install from npm
            </a>
            <Link href="/docs/" className="text-zinc-300 hover:text-white">
              Read the docs
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
