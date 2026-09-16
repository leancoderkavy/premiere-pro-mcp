"use client"

import { useEffect, useRef, useState } from "react"
import { Accordion, Tabs } from "radix-ui"
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Play,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Terminal
} from "lucide-react"
import Image from "next/image"
import { product, safeFirstPrompt } from "@/lib/product"
import { connectorSetup, localMcpEntry } from "@/lib/client-setup"
import { trackOnboardingEvent } from "@/lib/onboarding-events"
import { faqItems } from "@/components/sections/faq"
import { studioArtwork } from "@/lib/studio-artwork"

const chapters = [
  {
    id: "edit",
    number: "01",
    title: "Build an assembly.",
    label: "Editing",
    description:
      "Build assemblies, work with timeline clips, and prepare edits from a clear instruction. Review the plan before supported changes reach Premiere.",
    icon: Scissors,
    artwork: studioArtwork.sequence,
    prompt: "Prepare a rough assembly from these selects.",
    response:
      "Review the sequence, clip order, and target tracks before applying."
  },
  {
    id: "organize",
    number: "02",
    title: "Organize project media.",
    label: "Organization",
    description:
      "Inspect project media, organize bins, and prepare an intake report. Keep project context local and include it only when you choose.",
    icon: FolderOpen,
    artwork: studioArtwork.collection,
    prompt: "Inspect this project and propose a bin structure.",
    response:
      "Read-only intake first. Review proposed organization actions next."
  },
  {
    id: "finish",
    number: "03",
    title: "Check effects and exports.",
    label: "Finishing",
    description:
      "Work with effects, keyframes, color, and export workflows. Inspect host capabilities and returned diagnostics before relying on the result.",
    icon: SlidersHorizontal,
    artwork: studioArtwork.finish,
    prompt: "Check this sequence before delivery.",
    response:
      "Inspect supported settings and diagnostics. Confirm the export target."
  }
]

export function WorkflowChapters() {
  return (
    <Tabs.Root
      defaultValue="edit"
      orientation="horizontal"
      className="studio-feature-tabs"
    >
      <Tabs.List
        className="studio-feature-navigation"
        aria-label="Explore editing workflows"
      >
        {chapters.map((chapter) => (
          <Tabs.Trigger
            key={chapter.id}
            value={chapter.id}
            className="studio-feature-tab"
            aria-label={`${chapter.number} ${chapter.title} ${chapter.label}`}
          >
            {chapter.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {chapters.map((chapter) => (
        <Tabs.Content
          value={chapter.id}
          key={chapter.id}
          className="studio-dark studio-feature-panel"
        >
          <div className="studio-feature-summary">
            <chapter.icon size={28} strokeWidth={1.5} />
            <h3>{chapter.title}</h3>
            <p>{chapter.description}</p>
          </div>
          <figure className="studio-feature-art">
            <picture>
              <source
                media="(max-width: 767px)"
                srcSet={chapter.artwork.mobileSrc}
              />
              <Image
                src={chapter.artwork.src}
                alt={chapter.artwork.alt}
                width={1600}
                height={914}
                sizes="(max-width: 900px) 94vw, 780px"
              />
            </picture>
            <figcaption>Illustrated workflow</figcaption>
          </figure>
          <div className="studio-feature-request">
            <div>
              <span>Try asking</span>
              <p>“{chapter.prompt}”</p>
            </div>
            <p className="studio-feature-response">
              <ShieldCheck size={15} />
              {chapter.response}
            </p>
          </div>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}

export function WalkthroughPlayer() {
  const [playing, setPlaying] = useState(false)
  return (
    <div className="studio-video-shell">
      {playing ? (
        <video
          controls
          autoPlay
          playsInline
          preload="metadata"
          poster="/premiere-pro-mcp-ad-v3-poster-1280.webp"
          aria-label="Live Premiere Pro recording: assemble three clips, add review markers, and inspect the saved timeline"
        >
          <source src="/premiere-pro-mcp-ad-v3.mp4" type="video/mp4" />
          <track kind="captions" src="/premiere-pro-mcp-ad-v3.vtt" srcLang="en" label="English" />
          Your browser cannot play this video.{" "}
          <a href="/premiere-pro-mcp-ad-v3.mp4">Open the walkthrough</a>.
        </video>
      ) : (
        <button
          className="studio-video-cover"
          onClick={() => {
            setPlaying(true)
            trackOnboardingEvent("marketing_demo_played", {
              demo: "cinematic_ad_v3"
            })
          }}
          aria-label="Play the walkthrough — live Premiere Pro recording"
        >
          <div className="studio-demo-wordmark" aria-hidden="true">
            <span>Request. Review.</span>
            <span>Confirm.</span>
          </div>
          <div className="studio-demo-still">
            <picture>
              <source
                media="(max-width: 767px)"
                srcSet="/premiere-pro-mcp-ad-v3-poster-640.webp"
              />
              <Image
                src="/premiere-pro-mcp-ad-v3-poster-1280.webp"
                alt=""
                width={1600}
                height={914}
                sizes="(max-width: 768px) 90vw, 720px"
              />
            </picture>
          </div>
          <span className="studio-video-shade" />
          <span className="studio-video-top" aria-hidden="true">
            RECORDED IN PREMIERE PRO
          </span>
          <span className="studio-video-play">
            <Play size={24} fill="currentColor" />
            <span>Play the walkthrough · 30 sec</span>
          </span>
        </button>
      )}
    </div>
  )
}

const clients = [
  {
    id: "claude",
    name: "Claude Desktop",
    tag: "RECOMMENDED",
    title: "Install the Claude Desktop bundle.",
    detail:
      "The self-contained Claude bundle includes the local MCP server. Add the Premiere connector below to complete the bridge.",
    action: "Download Claude bundle",
    href: product.downloads.claudeBundle
  },
  {
    id: "codex",
    name: "Codex",
    tag: "REPOSITORY PLUGIN",
    title: "Set up the Codex plugin.",
    detail:
      "Install this repository’s Codex plugin from a local clone. It includes the MCP configuration and editing skill; the Premiere connector is installed separately.",
    action: "Open Codex setup guide",
    href: "/blog/codex-premiere-pro-mcp-setup/"
  },
  {
    id: "cursor",
    name: "Cursor",
    tag: "GUIDED SETUP",
    title: "Configure Cursor’s MCP connection.",
    detail:
      "Use Cursor’s MCP settings with the local server. This guided route requires Node.js and the separate Premiere connector.",
    action: "Open Cursor setup guide",
    href: "/blog/how-to-set-up-premiere-pro-mcp/"
  },
  {
    id: "vscode",
    name: "VS Code / Copilot",
    tag: "GUIDED SETUP",
    title: "Connect VS Code or Copilot.",
    detail:
      "Connect the local MCP server through your editor’s MCP settings. Install the Premiere connector on the same computer.",
    action: "Read the setup documentation",
    href: product.links.readme
  },
  {
    id: "other",
    name: "Another client",
    tag: "LOCAL MCP",
    title: "Configure another MCP client.",
    detail:
      "Other compatible MCP clients can use the local server command. Follow the client’s configuration guide; a native installer is not shipped for every client.",
    action: "Check client compatibility",
    href: "/docs/"
  }
]

function CopyPrompt({
  text,
  command = false
}: {
  text: string
  command?: boolean
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle")
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (reset.current) clearTimeout(reset.current)
    },
    []
  )
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus("copied")
      if (!command) trackOnboardingEvent("onboarding_safe_prompt_copied")
      if (reset.current) clearTimeout(reset.current)
      reset.current = setTimeout(() => setStatus("idle"), 2500)
    } catch {
      setStatus("error")
    }
  }
  return (
    <div className="studio-copy-wrap">
      <button
        type="button"
        className="studio-copy"
        onClick={copy}
        aria-label={
          command
            ? "Copy installation commands"
            : "Copy the safe connection prompt"
        }
      >
        {status === "copied" ? <Check size={15} /> : <Copy size={15} />}
        <span>{status === "copied" ? "Copied" : "Copy"}</span>
      </button>
      <span
        className={status === "error" ? "studio-copy-error" : "studio-sr-only"}
        role="status"
      >
        {status === "error"
          ? "Clipboard unavailable. Select and copy the text above."
          : status === "copied"
            ? "Copied to clipboard."
            : ""}
      </span>
    </div>
  )
}

export function StudioInstaller() {
  return (
    <Tabs.Root
      defaultValue="claude"
      className="studio-installer"
      onValueChange={(assistant) =>
        trackOnboardingEvent("onboarding_assistant_selected", { assistant })
      }
    >
      <Tabs.List
        className="studio-client-tabs"
        aria-label="Choose your AI assistant"
      >
        {clients.map((client) => (
          <Tabs.Trigger key={client.id} value={client.id}>
            {client.name}
            <ArrowUpRight size={14} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {clients.map((client) => (
        <Tabs.Content
          value={client.id}
          key={client.id}
          className="studio-client-content"
        >
          <div className="studio-client-intro">
            <span className="studio-label studio-accent">{client.tag}</span>
            <h3>{client.title}</h3>
            <p>{client.detail}</p>
            <a
              className="studio-button studio-button-primary"
              href={client.href}
              onClick={() =>
                trackOnboardingEvent(
                  client.id === "claude"
                    ? "onboarding_download_started"
                    : "primary_cta_clicked",
                  client.id === "claude"
                    ? { route: "claude" }
                    : { location: "install", destination: client.id }
                )
              }
            >
              {client.id === "claude" ? (
                <Download size={17} />
              ) : (
                <ArrowUpRight size={17} />
              )}
              {client.action}
            </a>
            <span className="studio-install-note">
              Free & open source · macOS + Windows
            </span>
          </div>
          <ol className="studio-setup-steps">
            <li>
              <span>01</span>
              <div>
                <h4>Add the Premiere connector.</h4>
                <p>
                  Install the signed CEP package with a trusted ZXP installer,
                  or use the npm route below.
                </p>
                <a
                  href={product.downloads.signedCepConnector}
                  onClick={() =>
                    trackOnboardingEvent("onboarding_download_started", {
                      route: "cep_connector"
                    })
                  }
                >
                  Download Premiere connector <ArrowDown size={14} />
                </a>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h4>Connect your assistant.</h4>
                <p>
                  Complete the selected setup route. Restart Premiere and your
                  assistant, then open a project and sequence.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h4>Start with a safe check.</h4>
                <p>
                  Use the prompt below. It checks the connection without
                  changing your project. Preview your first edit next.
                </p>
              </div>
            </li>
          </ol>
        </Tabs.Content>
      ))}
      <div className="studio-safe-prompt">
        <div>
          <span className="studio-label">
            <ShieldCheck size={13} /> YOUR FIRST PROMPT / READ ONLY
          </span>
          <p>{safeFirstPrompt}</p>
        </div>
        <CopyPrompt text={safeFirstPrompt} />
      </div>
      <Accordion.Root type="multiple" className="studio-advanced">
        <Accordion.Item value="advanced">
          <Accordion.Header>
            <Accordion.Trigger
              onClick={() => trackOnboardingEvent("onboarding_advanced_opened")}
            >
              <span>
                <Code2 size={17} /> Advanced setup & compatibility
              </span>
              <ChevronDown size={17} />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <div className="studio-install-callout">
              <p className="studio-install-callout-title">
                Install the correct package
              </p>
              <p>Use the exact npm package name for this project:</p>
              <pre>npm i -g premiere-pro-mcp@{product.version}</pre>
              <p>
                <strong>Name check:</strong> this project&apos;s package is{" "}
                <code>premiere-pro-mcp</code>, not{" "}
                <code>adobe-premiere-pro-mcp</code>. Both can expose a{" "}
                <code>premiere-pro-mcp</code> command, so confirm the package
                name before you configure a client.
              </p>
              <p className="studio-install-callout-title">
                Verify you have the right install
              </p>
              <pre>
                npm list -g premiere-pro-mcp{"\n"}premiere-pro-mcp --version
              </pre>
              <p>
                Expect version <strong>{product.version}</strong>. Homepage
                should be{" "}
                <a href="https://premiere-pro-mcp.com/">
                  premiere-pro-mcp.com
                </a>
                ; source is{" "}
                <a href="https://github.com/leancoderkavy/premiere-pro-mcp">
                  github.com/leancoderkavy/premiere-pro-mcp
                </a>
                .
              </p>
            </div>
            <div className="studio-advanced-grid">
              <div>
                <p>
                  For manual clients, install Node.js {product.nodeVersion}+ and
                  run:
                </p>
                <pre>{connectorSetup}</pre>
                <CopyPrompt text={connectorSetup} command />
                <p>
                  Set the local MCP server command to{" "}
                  <code>{localMcpEntry.command}</code> with arguments{" "}
                  <code>{localMcpEntry.args.join(" ")}</code>.
                </p>
              </div>
              <div>
                <p>
                  Signed CEP is the default route for Premiere Pro{" "}
                  {product.premiereCompatibility}. UXP adds capability-gated
                  workflows on compatible {product.uxpMinimumVersion}+ hosts; it
                  is not the default installer or a Creative Cloud Marketplace
                  install.
                </p>
                <a href="/docs/">
                  Full installation documentation <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          </Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="recovery">
          <Accordion.Header>
            <Accordion.Trigger
              onClick={() => trackOnboardingEvent("onboarding_recovery_opened")}
            >
              <span>
                <Terminal size={17} /> Need help connecting?
              </span>
              <ChevronDown size={17} />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <p>
              Restart Premiere and your assistant. Open a project and an active
              sequence, then find{" "}
              <strong>Window → Extensions → MCP for Adobe Premiere Pro</strong>.
              Run the safe prompt again. Share the connection state with
              support, without project media.
            </p>
            <a href="/docs/troubleshooting/">
              Open setup and recovery <ArrowUpRight size={14} />
            </a>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
      <p className="studio-privacy-note">
        The bridge keeps project media on your machine. Your assistant’s
        separate privacy settings still apply. Optional analytics records setup
        actions, never your prompts or footage.{" "}
        <a href="/privacy/">Privacy details ↗</a>
      </p>
    </Tabs.Root>
  )
}

export function StudioFaq() {
  return (
    <Accordion.Root type="single" collapsible className="studio-faq-list">
      {faqItems.map((item, index) => (
        <Accordion.Item key={item.question} value={String(index)}>
          <Accordion.Header>
            <Accordion.Trigger>
              <span>{item.question}</span>
              <span className="studio-faq-plus" aria-hidden="true">
                +
              </span>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <p>{item.answer}</p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}
