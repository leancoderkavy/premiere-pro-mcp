"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

const clients = [
  { id: "claude", name: "Claude Desktop", file: "claude_desktop_config.json", path: "Claude application support folder" },
  { id: "cursor", name: "Cursor", file: ".cursor/mcp.json", path: "Project root or global Cursor config" },
  { id: "windsurf", name: "Windsurf", file: "mcp_config.json", path: "Windsurf user config folder" },
  { id: "generic", name: "Any MCP client", file: "MCP configuration", path: "See your client’s MCP documentation" },
]

const config = `{
  "mcpServers": {
    "premiere-pro": {
      "command": "premiere-pro-mcp"
    }
  }
}`

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      aria-label={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

export function ConnectSection() {
  const [active, setActive] = useState(clients[0].id)
  const current = clients.find((client) => client.id === active) ?? clients[0]

  return (
    <section id="install" className="reveal-section bg-black px-5 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white md:text-5xl">Get started locally in three steps</h2>
          <p className="mt-5 text-lg leading-8 text-zinc-400">
            The local stdio setup is the simplest and safest path. Premiere, the CEP bridge, and your MCP client stay on the same machine.
          </p>
        </div>

        <ol className="relative mt-16 grid gap-8 md:grid-cols-3">
          <div className="absolute left-[16.5%] right-[16.5%] top-5 hidden h-px bg-zinc-800 md:block" aria-hidden="true" />
          {[
            { number: "1", title: "Install the server", command: "npm install -g premiere-pro-mcp", note: "Requires Node.js 18 or newer." },
            { number: "2", title: "Install the CEP bridge", command: "premiere-pro-mcp --install-cep", note: "Uses the native macOS or Windows installer." },
            { number: "3", title: "Configure your MCP client", command: "premiere-pro-mcp", note: "Restart Premiere and your MCP client once." },
          ].map((step) => (
            <li key={step.number} className="relative text-center">
              <span className="relative z-10 mx-auto grid h-10 w-10 place-items-center rounded-full border border-purple-300/40 bg-purple-500/20 text-sm font-bold text-purple-100 shadow-[0_0_28px_rgba(168,85,247,0.18)]">
                {step.number}
              </span>
              <h3 className="mt-6 text-base font-semibold text-white">{step.title}</h3>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-left">
                <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-emerald-400">{step.command}</code>
                <CopyButton text={step.command} label={`Copy ${step.title} command`} />
              </div>
              <p className="mt-3 text-sm text-zinc-500">{step.note}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 overflow-hidden rounded-xl border border-zinc-800 bg-[#08080a]">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-sm font-semibold text-white">Choose your MCP client</p>
            <p className="mt-1 text-xs text-zinc-500">The same local server command works across supported clients.</p>
          </div>
          <div className="grid lg:grid-cols-[15rem_1fr]">
            <div className="flex overflow-x-auto border-b border-zinc-800 p-3 lg:flex-col lg:border-b-0 lg:border-r">
              {clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setActive(client.id)}
                  aria-pressed={active === client.id}
                  className={`whitespace-nowrap rounded-md px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                    active === client.id ? "bg-purple-500/15 text-purple-200" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  {client.name}
                </button>
              ))}
            </div>
            <div className="min-w-0 p-5 sm:p-7">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Add this server to <code className="text-purple-300">{current.file}</code></p>
                  <p className="mt-1 text-xs text-zinc-500">{current.path}</p>
                </div>
                <CopyButton text={config} label={`Copy ${current.name} configuration`} />
              </div>
              <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black p-5 font-mono text-sm leading-7 text-zinc-300"><code>{config}</code></pre>
              <p className="mt-4 text-sm leading-6 text-zinc-500">
                The bridge starts automatically when Premiere launches. Open <span className="text-zinc-300">Window → Extensions → MCP Bridge</span> only to verify status or change the shared temp directory.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
