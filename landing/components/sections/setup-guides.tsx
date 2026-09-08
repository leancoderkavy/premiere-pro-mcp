import Link from "next/link"

export function SetupGuides() {
  return (
    <nav aria-label="Setup guides" className="mt-8 border-y border-zinc-800 py-5">
      <p className="font-semibold text-zinc-100">Follow the guide for your client</p>
      <ul className="mt-3 grid gap-x-8 sm:grid-cols-2">
        {[
          ["Claude Desktop: install and verify", "/blog/claude-desktop-premiere-pro-mcp-setup/"],
          ["Codex: configure the local MCP server", "/blog/codex-premiere-pro-mcp-setup/"],
          ["Installation and connector requirements", "/blog/how-to-set-up-premiere-pro-mcp/"],
          ["ChatGPT: check connection requirements", "/blog/chatgpt-premiere-pro-mcp/"],
        ].map(([label, href]) => <li key={href}><Link href={href} className="inline-flex min-h-11 items-center py-2 text-sm text-purple-200 underline underline-offset-4 hover:text-white">{label}</Link></li>)}
      </ul>
    </nav>
  )
}
