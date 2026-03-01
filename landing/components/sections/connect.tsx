"use client"

import { useState } from "react"
import { BorderBeam } from "@/components/ui/border-beam"
import { Check, Copy, Bot, Keyboard, Wind, Plug } from "lucide-react"

const MCP_URL = "https://premiere-pro-mcp.fly.dev/mcp"

const clients = [
  {
    id: "claude",
    name: "Claude Desktop",
    icon: Bot,
    file: "claude_desktop_config.json",
    path: "~/Library/Application Support/Claude/",
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}"
      ]
    }
  }
}`,
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: Keyboard,
    file: ".cursor/mcp.json",
    path: "project root or ~/.cursor/",
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}"
      ]
    }
  }
}`,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    icon: Wind,
    file: "~/.codeium/windsurf/mcp_config.json",
    path: "~/.codeium/windsurf/",
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}"
      ]
    }
  }
}`,
  },
  {
    id: "generic",
    name: "Any MCP Client",
    icon: Plug,
    file: "mcp config",
    path: "check your client's docs",
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "${MCP_URL}"
      ]
    }
  }
}`,
  },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  )
}

export function ConnectSection() {
  const [active, setActive] = useState("claude")
  const current = clients.find((c) => c.id === active)!

  return (
    <section className="bg-zinc-950 px-4 py-24">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-4 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            Live at premiere-pro-mcp.fly.dev
          </span>
        </div>
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl">
            Connect your LLM in 60 seconds
          </h2>
          <p className="mt-4 mx-auto max-w-xl text-zinc-400">
            No local install required. Point any MCP-compatible AI client at our hosted endpoint and start editing Premiere Pro with AI immediately.
          </p>
        </div>

        {/* Steps */}
        <div className="mb-12 grid gap-4 md:grid-cols-3">
          {[
            { n: "1", title: "Install mcp-remote", desc: "One-time prerequisite — a tiny proxy that bridges HTTP/SSE to stdio.", cmd: "npm install -g mcp-remote" },
            { n: "2", title: "Add config to your client", desc: "Paste the JSON snippet below into your AI client's MCP config file.", cmd: null },
            { n: "3", title: "Install the CEP panel", desc: "Run once on the machine with Premiere Pro to enable the file bridge.", cmd: "premiere-pro-mcp --install-cep" },
          ].map((step) => (
            <div key={step.n} className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black p-5">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                  {step.n}
                </span>
                <h3 className="text-sm font-semibold text-white">{step.title}</h3>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-zinc-500">{step.desc}</p>
              {step.cmd && (
                <code className="block rounded bg-zinc-900 px-3 py-2 text-xs text-green-400">
                  $ {step.cmd}
                </code>
              )}
            </div>
          ))}
        </div>

        {/* Client picker + config */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black">
          <BorderBeam colorFrom="#9999ff" colorTo="#ff6699" duration={10} />

          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-3">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  active === c.id
                    ? "bg-purple-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                <c.icon className="h-4 w-4" />
                {c.name}
              </button>
            ))}
          </div>

          {/* Config body */}
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">
                  Add to <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-purple-300">{current.file}</code>
                </p>
                <p className="mt-1 text-xs text-zinc-500">Path: {current.path}</p>
              </div>
              <CopyButton text={current.config} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-300 border border-zinc-800">
              <code>{current.config}</code>
            </pre>

            {/* Endpoint pill */}
            <div className="mt-4 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-zinc-400">MCP endpoint</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-purple-300">{MCP_URL}</code>
                <CopyButton text={MCP_URL} />
              </div>
            </div>
          </div>
        </div>

        {/* Prerequisite note */}
        <p className="mt-6 text-center text-sm text-zinc-600">
          Requires <span className="text-zinc-400">Node.js 18+</span> and the{" "}
          <a href="https://github.com/leancoderkavy/premiere-pro-mcp#cep-plugin" target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:text-purple-400 underline">
            CEP panel
          </a>{" "}
          installed on the machine running Premiere Pro.
        </p>
      </div>
    </section>
  )
}
