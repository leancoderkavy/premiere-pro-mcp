"use client"

import { useEffect, useRef, useState } from "react"
import { Accordion, Dialog, Tabs } from "radix-ui"
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Menu,
  Play,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  X
} from "lucide-react"
import Image from "next/image"
import { product, safeFirstPrompt } from "@/lib/product"
import { trackOnboardingEvent } from "@/lib/onboarding-events"
import { faqItems } from "@/components/sections/faq"

export function StudioMobileNav() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="studio-menu" aria-label="Open navigation">
          <Menu size={21} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="studio-dialog-overlay" />
        <Dialog.Content className="studio-nav-dialog">
          <Dialog.Title>Explore Premiere Pro MCP</Dialog.Title>
          <Dialog.Description className="studio-sr-only">
            Homepage sections and product resources.
          </Dialog.Description>
          <Dialog.Close
            className="studio-dialog-close"
            aria-label="Close navigation"
          >
            <X />
          </Dialog.Close>
          {[
            ["The workflow", "#features"],
            ["How it works", "#how-it-works"],
            ["Connect to Premiere", "#install"],
            ["Questions", "#faq"],
            ["Documentation", "/docs/"],
            ["Guides", "/blog/"]
          ].map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
              <ArrowUpRight size={20} />
            </a>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const chapters = [
  {
    id: "edit",
    number: "01",
    title: "Shape the story.",
    description:
      "Build assemblies, work with timeline clips, and prepare edits from a clear instruction. Review the plan before supported changes reach Premiere.",
    icon: Scissors,
    titleLabel: "TIMELINE / ASSEMBLY",
    prompt: "Prepare a rough assembly from these selects.",
    response:
      "Review the sequence, clip order, and target tracks before applying.",
    tracks: ["SELECTS / OPENING", "BUILD THE MOMENT", "THE REVEAL"]
  },
  {
    id: "organize",
    number: "02",
    title: "Find your focus.",
    description:
      "Inspect project media, organize bins, and prepare an intake report. Keep project context local and include it only when you choose.",
    icon: FolderOpen,
    titleLabel: "PROJECT / ORGANIZATION",
    prompt: "Inspect this project and propose a bin structure.",
    response:
      "Read-only intake first. Review proposed organization actions next.",
    tracks: ["01 / PICTURE", "02 / SOUND", "03 / GRAPHICS"]
  },
  {
    id: "finish",
    number: "03",
    title: "Sweat the details.",
    description:
      "Work with effects, keyframes, color, and export workflows. Inspect host capabilities and returned diagnostics before relying on the result.",
    icon: SlidersHorizontal,
    titleLabel: "FINISH / DELIVERY",
    prompt: "Check this sequence before delivery.",
    response:
      "Inspect supported settings and diagnostics. Confirm the export target.",
    tracks: ["COLOR / REVIEW", "AUDIO / CHECK", "DELIVERY / PREFLIGHT"]
  }
]

export function WorkflowChapters() {
  return (
    <Tabs.Root
      defaultValue="edit"
      orientation="vertical"
      className="studio-chapters"
    >
      <Tabs.List
        className="studio-chapter-list"
        aria-label="Explore editing workflows"
      >
        {chapters.map((chapter) => (
          <Tabs.Trigger
            key={chapter.id}
            value={chapter.id}
            className="studio-chapter"
          >
            <span className="studio-chapter-number">{chapter.number}</span>
            <span>
              <strong>{chapter.title}</strong>
              <span className="studio-chapter-description">
                {chapter.description}
              </span>
            </span>
            <ArrowUpRight size={20} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {chapters.map((chapter) => (
        <Tabs.Content
          value={chapter.id}
          key={chapter.id}
          className="studio-chapter-panel"
        >
          <div className="studio-panel-toolbar">
            <span>
              <chapter.icon size={14} />
              {chapter.titleLabel}
            </span>
            <span className="studio-live-dot">ILLUSTRATED WORKFLOW</span>
          </div>
          <div className="studio-workflow-frame">
            <Image
              src="/marketing/cinematic-portal.webp"
              alt="Cinematic sample artwork for the illustrated editing workflow"
              width={1280}
              height={736}
              sizes="(max-width: 768px) 90vw, 650px"
            />
            <span className="studio-frame-corner">IN / 00:00:00:00</span>
            <span className="studio-frame-corner studio-frame-out">
              OUT / 00:00:32:00
            </span>
          </div>
          <div
            className={`studio-workflow-tracks studio-workflow-${chapter.id}`}
            aria-hidden="true"
          >
            {chapter.tracks.map((track, i) => (
              <div key={track}>
                <span>{i + 1}</span>
                <div>{track}</div>
              </div>
            ))}
          </div>
          <div className="studio-workflow-prompt">
            <span className="studio-prompt-glyph">
              <Terminal size={17} />
            </span>
            <p>{chapter.prompt}</p>
            <ArrowRight size={18} />
          </div>
          <p className="studio-workflow-response">
            <ShieldCheck size={15} />
            {chapter.response}
          </p>
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
          muted
          playsInline
          preload="metadata"
          poster="/premiere-pro-mcp-demo-poster.png"
          aria-label="Illustrated workflow animation; not a live Premiere recording"
        >
          <source src="/premiere-pro-mcp-demo.mp4" type="video/mp4" />
          Your browser cannot play this video.{" "}
          <a href="/premiere-pro-mcp-demo.mp4">Open the walkthrough</a>.
        </video>
      ) : (
        <button
          className="studio-video-cover"
          onClick={() => {
            setPlaying(true)
            trackOnboardingEvent("marketing_demo_played", {
              demo: "illustrated_workflow"
            })
          }}
          aria-label="Play the walkthrough — illustrated product workflow"
        >
          <Image
            src="/marketing/cinematic-portal.webp"
            alt=""
            fill
            sizes="(max-width: 768px) 95vw, 1280px"
          />
          <span className="studio-video-shade" />
          <span className="studio-video-top" aria-hidden="true">
            A REQUEST. A PLAN. A REVIEWABLE RESULT.
          </span>
          <span className="studio-video-play">
            <Play size={24} fill="currentColor" />
            <span>Play the walkthrough</span>
          </span>
          <span className="studio-video-bottom" aria-hidden="true">
            <span>SEE THE POSSIBILITIES.</span>
            <ArrowUpRight size={30} />
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
    title: "A familiar assistant. A new connection.",
    detail:
      "The self-contained Claude bundle includes the local MCP server. Add the Premiere connector below to complete the bridge.",
    action: "Download Claude bundle",
    href: product.downloads.claudeBundle
  },
  {
    id: "cursor",
    name: "Cursor",
    tag: "GUIDED SETUP",
    title: "Bring your editor into the edit.",
    detail:
      "Use Cursor’s MCP settings with the local server. This guided route requires Node.js and the separate Premiere connector.",
    action: "Open Cursor setup guide",
    href: "/blog/how-to-set-up-premiere-pro-mcp/"
  },
  {
    id: "vscode",
    name: "VS Code / Copilot",
    tag: "GUIDED SETUP",
    title: "Your workspace. Connected to Premiere.",
    detail:
      "Connect the local MCP server through your editor’s MCP settings. Install the Premiere connector on the same computer.",
    action: "Read the setup documentation",
    href: product.links.readme
  },
  {
    id: "other",
    name: "Another client",
    tag: "LOCAL MCP",
    title: "Choose the assistant that fits.",
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
            <span className="studio-label studio-green">{client.tag}</span>
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
            <div className="studio-advanced-grid">
              <div>
                <p>
                  For manual clients, install Node.js {product.nodeVersion}+ and
                  run:
                </p>
                <pre>
                  npm install -g premiere-pro-mcp{"\n"}premiere-pro-mcp
                  --install-cep
                </pre>
                <CopyPrompt
                  text={
                    "npm install -g premiere-pro-mcp\npremiere-pro-mcp --install-cep"
                  }
                  command
                />
                <p>
                  Set the local MCP server command to{" "}
                  <code>premiere-pro-mcp</code>.
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
