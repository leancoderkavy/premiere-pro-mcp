import { BorderBeam } from "@/components/ui/border-beam"

const tabs = [
  {
    label: "Local (stdio)",
    steps: [
      { cmd: "npm install -g premiere-pro-mcp", comment: "# Install globally" },
      { cmd: "premiere-pro-mcp --install-cep", comment: "# Install the CEP panel into Premiere" },
    ],
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "premiere-pro-mcp"
    }
  }
}`,
    note: "Works with Claude Desktop, Windsurf, Cursor, and any MCP client that supports stdio.",
  },
  {
    label: "Remote (Fly.io)",
    steps: [
      { cmd: "npm install -g mcp-remote", comment: "# Install mcp-remote proxy" },
    ],
    config: `{
  "mcpServers": {
    "premiere-pro": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://premiere-pro-mcp.fly.dev/mcp"
      ]
    }
  }
}`,
    note: "Note: the file bridge still requires the CEP plugin on the same machine or a shared volume.",
  },
]

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <BorderBeam colorFrom="#9999ff" colorTo="#ff6699" duration={10} size={60} />
      {label && (
        <div className="border-b border-zinc-800 px-4 py-2">
          <span className="text-xs text-zinc-500">{label}</span>
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function InstallSection() {
  return (
    <section className="bg-black px-4 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">Get started</p>
          <h2 className="mt-2 text-3xl font-bold text-white md:text-4xl">Two ways to connect</h2>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {tabs.map((tab) => (
            <div key={tab.label} className="space-y-4">
              <h3 className="text-xl font-semibold text-white">{tab.label}</h3>

              <div className="space-y-2">
                {tab.steps.map((s) => (
                  <div key={s.cmd} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-sm">
                    <span className="text-zinc-600">{s.comment}{"\n"}</span>
                    <span className="text-green-400">$ {s.cmd}</span>
                  </div>
                ))}
              </div>

              <CodeBlock code={tab.config} label="mcp config" />

              <p className="text-sm text-zinc-500">{tab.note}</p>
            </div>
          ))}
        </div>

        {/* npm badge row */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-4">
          {[
            { label: "npm", href: "https://www.npmjs.com/package/premiere-pro-mcp", badge: "v1.1.0" },
            { label: "GitHub", href: "https://github.com/ppmcp/premiere-pro-mcp", badge: "MIT" },
            { label: "MCP", href: "https://modelcontextprotocol.io", badge: "1.27" },
            { label: "Node.js", href: "https://nodejs.org", badge: "18+" },
          ].map((b) => (
            <a
              key={b.label}
              href={b.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0 overflow-hidden rounded text-xs font-semibold"
            >
              <span className="bg-zinc-700 px-2 py-1 text-zinc-300">{b.label}</span>
              <span className="bg-purple-700 px-2 py-1 text-white">{b.badge}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
