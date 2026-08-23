"use client"

import { useState } from "react"
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  LockKeyhole,
  MonitorCog,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

import { product, safeFirstPrompt } from "@/lib/product"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

type AssistantRoute = {
  id: "claude" | "cursor" | "vscode" | "other"
  name: string
  shortDescription: string
  availability: string
  primaryAction: string
  href: string
  detail: string
  status: "recommended" | "guided" | "advanced"
}

const assistantRoutes: AssistantRoute[] = [
  {
    id: "claude",
    name: "Claude Desktop",
    shortDescription: "Download the self-contained desktop bundle.",
    availability: "Recommended for the easiest start",
    primaryAction: "Download Claude Desktop bundle",
    href: product.downloads.claudeBundle,
    detail:
      "Open the downloaded bundle in Claude Desktop. It includes the local server, so this path does not ask you to install Node just to connect Claude.",
    status: "recommended",
  },
  {
    id: "cursor",
    name: "Cursor",
    shortDescription: "Use Cursor’s MCP settings to add the local connector.",
    availability: "Guided route",
    primaryAction: "Read the Cursor setup guide",
    href: product.links.readme,
    detail:
      "A one-click Cursor installer is not currently shipped. The guide explains the supported local route; manual configuration stays in Advanced setup below.",
    status: "guided",
  },
  {
    id: "vscode",
    name: "VS Code / Copilot",
    shortDescription: "Connect through your editor’s MCP settings.",
    availability: "Guided route",
    primaryAction: "Read the VS Code setup guide",
    href: product.links.readme,
    detail:
      "A VS Code Marketplace install is not currently shipped. Use the guide for the supported local route, or see Advanced setup if your editor asks for a server command.",
    status: "guided",
  },
  {
    id: "other",
    name: "Another assistant",
    shortDescription: "Use any MCP-compatible desktop client.",
    availability: "Advanced route",
    primaryAction: "Open compatibility guide",
    href: product.links.readme,
    detail:
      "If your assistant supports local MCP servers, it can use MCP for Adobe Premiere Pro. Its setup may require its own settings screen or the manual configuration in Advanced setup.",
    status: "advanced",
  },
]

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      trackOnboardingEvent("onboarding_safe_prompt_copied")
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]"
      aria-label={label}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy prompt"}</span>
    </button>
  )
}

function statusClasses(status: AssistantRoute["status"]) {
  if (status === "recommended") return "border-purple-400/50 bg-purple-500/[0.08] text-purple-100"
  if (status === "guided") return "border-zinc-700 bg-zinc-950 text-zinc-200"
  return "border-zinc-800 bg-zinc-950/50 text-zinc-300"
}

export function ConnectSection() {
  const [activeId, setActiveId] = useState<AssistantRoute["id"]>("claude")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const activeRoute = assistantRoutes.find((route) => route.id === activeId) ?? assistantRoutes[0]

  function selectRoute(route: AssistantRoute) {
    setActiveId(route.id)
    trackOnboardingEvent("onboarding_assistant_selected", { assistant: route.id })
  }

  function trackDownload(route: AssistantRoute) {
    trackOnboardingEvent("onboarding_download_started", { route: route.id })
  }

  return (
    <section id="install" className="reveal-section bg-black px-5 py-24 md:py-32" aria-labelledby="setup-heading">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <h2 id="setup-heading" className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">
            Start with your <span className="text-purple-400">AI assistant.</span>
          </h2>
          <p className="mt-5 text-lg leading-8 text-zinc-400">
            Choose the assistant you already use. We&apos;ll keep the first check simple: connect it to Premiere, confirm the connection, and make no changes.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="AI assistant setup routes">
          {assistantRoutes.map((route) => {
            const selected = activeId === route.id
            return (
              <button
                key={route.id}
                type="button"
                onClick={() => selectRoute(route)}
                aria-pressed={selected}
                className={`group flex min-h-52 flex-col rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-4 focus-visible:ring-offset-black ${
                  selected ? statusClasses(route.status) : "border-zinc-800 bg-[#08080a] text-zinc-300 hover:border-zinc-600 hover:bg-zinc-950"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  {route.status === "recommended" ? <Sparkles className="h-5 w-5 text-purple-300" aria-hidden="true" /> : <Laptop className="h-5 w-5 text-zinc-400" aria-hidden="true" />}
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{route.availability}</span>
                </span>
                <span className="mt-7 text-lg font-semibold text-white">{route.name}</span>
                <span className="mt-3 text-sm leading-6 text-zinc-400">{route.shortDescription}</span>
                {selected ? <CheckCircle2 className="mt-auto h-5 w-5 text-purple-300" aria-label={`${route.name} selected`} /> : <span className="mt-auto h-5 w-5 rounded-full border border-zinc-700" aria-hidden="true" />}
              </button>
            )
          })}
        </div>

        <div className="mt-6 grid gap-6 border-y border-zinc-800 py-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold text-zinc-100">{activeRoute.name}</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{activeRoute.detail}</p>
          </div>
          <a
            href={activeRoute.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackDownload(activeRoute)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#8b7cff] to-[#ef76b9] px-5 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(139,124,255,0.2)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
          >
            {activeRoute.id === "claude" ? <Download className="h-4 w-4" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
            {activeRoute.primaryAction}
          </a>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <h3 className="text-xl font-semibold text-white">You&apos;ll be ready in four clear steps.</h3>
            <ol className="mt-8 grid gap-7 sm:grid-cols-2">
              <li className="border-t border-purple-400/35 pt-5">
                <span className="font-mono text-sm text-purple-300">01</span>
                <h4 className="mt-4 text-base font-semibold text-zinc-100">Install the Premiere connector</h4>
                <p className="mt-2 text-sm leading-6 text-zinc-400">This separate CEP connector is what lets your assistant talk to Premiere. Open the download with a trusted ZXP installer; if your computer has none, use the npm installer under Advanced setup.</p>
                <a
                  href={product.downloads.signedCepConnector}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackOnboardingEvent("onboarding_download_started", { route: "cep_connector" })}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-purple-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Download connector package <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </li>
              <li className="border-t border-zinc-800 pt-5">
                <span className="font-mono text-sm text-purple-300">02</span>
                <h4 className="mt-4 text-base font-semibold text-zinc-100">Connect {activeRoute.name}</h4>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Finish the route above, then fully close and reopen both your assistant and Premiere.</p>
              </li>
              <li className="border-t border-zinc-800 pt-5">
                <span className="font-mono text-sm text-purple-300">03</span>
                <h4 className="mt-4 text-base font-semibold text-zinc-100">Run a safe check</h4>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Open a project and use the read-only prompt below. It runs the connection check and makes no changes.</p>
              </li>
              <li className="border-t border-zinc-800 pt-5">
                <span className="font-mono text-sm text-purple-300">04</span>
                <h4 className="mt-4 text-base font-semibold text-zinc-100">Ready to edit</h4>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Once the connection check passes, try a preview before applying any edits.</p>
              </li>
            </ol>

            <div className="mt-10 rounded-xl border border-purple-400/30 bg-purple-500/[0.06] p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-purple-100"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Safe first prompt</p>
                  <p className="mt-3 max-w-2xl font-mono text-sm leading-7 text-zinc-100">{safeFirstPrompt}</p>
                </div>
                <CopyButton text={safeFirstPrompt} label="Copy the safe first prompt" />
              </div>
            </div>
          </div>

          <aside className="space-y-5" aria-label="Setup help and privacy">
            <div className="rounded-xl border border-zinc-800 bg-[#08080a] p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><MonitorCog className="h-4 w-4 text-purple-300" aria-hidden="true" /> Compatibility, without guesswork</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">The signed CEP connector is the default compatibility route for Premiere Pro {product.premiereCompatibility} on Windows and macOS.</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">The modern UXP bridge is capability-gated for compatible Premiere {product.uxpMinimumVersion}+ workflows. It is not a Creative Cloud Marketplace install and does not replace CEP in the default path.</p>
              <a href="/docs/#compatibility-heading" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-purple-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]">
                See compatibility details <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-[#08080a] p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><LockKeyhole className="h-4 w-4 text-purple-300" aria-hidden="true" /> What the first check shares</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">The prompt runs a connection check; it makes no edits and does not ask for footage to be uploaded.</p>
              <p className="mt-3 text-sm leading-6 text-zinc-500">Your assistant&apos;s own privacy settings still apply. If site analytics is enabled, setup clicks record only a route and action—not prompts, media, project names, or file paths.</p>
            </div>

            <details
              className="group rounded-xl border border-zinc-800 bg-[#08080a] p-5"
              open={recoveryOpen}
              onToggle={(event) => {
                const open = event.currentTarget.open
                setRecoveryOpen(open)
                if (open) trackOnboardingEvent("onboarding_recovery_opened")
              }}
            >
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-zinc-100 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300">
                <span className="flex items-center gap-2"><CircleHelp className="h-4 w-4 text-purple-300" aria-hidden="true" /> Need help connecting?</span>
                <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-zinc-400">
                <li>Quit and reopen both Premiere and your assistant.</li>
                <li>Open a project and make sure an active sequence is selected.</li>
                <li>In Premiere, look for <span className="text-zinc-200">Window → Extensions → MCP for Adobe Premiere Pro</span>.</li>
                <li>Use the safe prompt again. If it still fails, share the connection state—not your project media—with support.</li>
              </ol>
              <a href={product.links.issues} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-purple-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]">
                Get connection help <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </details>
          </aside>
        </div>

        <details
          className="group mt-14 border-t border-zinc-800 pt-6"
          open={advancedOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open
            setAdvancedOpen(open)
            if (open) trackOnboardingEvent("onboarding_advanced_opened")
          }}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 text-sm font-semibold text-zinc-300 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300">
            <span>Advanced setup for npm, manual configuration, and other MCP clients</span>
            <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-5 grid gap-6 rounded-xl border border-zinc-800 bg-[#08080a] p-5 lg:grid-cols-2 lg:p-7">
            <div>
              <h3 className="text-base font-semibold text-white">Install from npm</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Use this route if your assistant does not support a native bundle. It requires Node.js {product.nodeVersion}+.</p>
              <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 text-xs leading-6 text-emerald-300"><code>npm install -g premiere-pro-mcp{`\n`}premiere-pro-mcp --install-cep</code></pre>
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Manual server configuration</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">Only use this when your client asks for a command. Keep Premiere, the connector, and the client on the same computer.</p>
              <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 text-xs leading-6 text-zinc-300"><code>{`{\n  "mcpServers": {\n    "premiere-pro": {\n      "command": "premiere-pro-mcp"\n    }\n  }\n}`}</code></pre>
            </div>
            <div className="lg:col-span-2">
              <a href={product.links.readme} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-purple-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]">
                Read the full technical guide <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </details>
      </div>
    </section>
  )
}
