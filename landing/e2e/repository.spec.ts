import { test, expect } from "@playwright/test"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import kits from "../lib/workflow-kits.json"
import { safeFirstPrompt } from "../lib/product"

test("the advertised first prompt and workflow kit tools exist in the actual local MCP server", async ({ request, baseURL }) => {
  expect((await request.post("/mcp", { data: {} })).status()).toBe(401)
  const client = new Client({ name: "homepage-repo-e2e", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer local-homepage-e2e-only" } },
  })
  try {
    await client.connect(transport)
    const catalog = await client.listTools()
    const safeTool = catalog.tools.find(tool => tool.name === "verify_premiere_connection")
    expect(safeFirstPrompt).toContain(safeTool?.name)
    expect(safeTool?.annotations?.readOnlyHint).toBe(true)
    const names = new Set(catalog.tools.map(tool => tool.name))
    for (const kit of kits) {
      for (const name of kit.tools) expect(names.has(name), `${kit.id}: ${name}`).toBe(true)
    }
    expect(client.getServerCapabilities()?.extensions?.["io.github.leancoderkavy/premiere-pro"]).toBeDefined()
  } finally {
    await client.close()
  }
})
