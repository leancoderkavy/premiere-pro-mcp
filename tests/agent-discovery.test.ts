import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../src/server.js";
import { getHealthTools } from "../src/tools/health.js";
import { resolveCapabilities } from "../src/security/capabilities.js";
import { resolveToolPacks } from "../src/workflows/tool-packs.js";

afterEach(() => vi.unstubAllEnvs());

const catalog = {
  get_transcript: { description: "Read speech evidence" },
  get_notes: { description: "Read transcript review notes" },
  delete_clip: { description: "Remove a transcript clip" },
  execute_extendscript: { description: "Run transcript scripts" },
};

describe("bounded agent tool discovery", () => {
  it("ranks exact names first and intersects query with explicit names", async () => {
    const tool = getHealthTools({}, resolveCapabilities("inspect"), () => catalog).get_capabilities;
    const exact = await tool.handler({ tool_query: " GET_TRANSCRIPT " });
    expect(exact.data?.tools.tools[0]).toMatchObject({ name: "get_transcript", registered: true });
    const result = await tool.handler({ tool_query: "transcript", tool_names: ["get_notes"] });
    expect(result.data?.tools.tools).toEqual([
      expect.objectContaining({ name: "get_notes", description: "Read transcript review notes", registered: true }),
    ]);
  });

  it("withholds unauthorized matches by default and labels diagnostic matches", async () => {
    const tool = getHealthTools({}, resolveCapabilities("inspect"), () => catalog).get_capabilities;
    const result = await tool.handler({ tool_query: "transcript" });
    expect(result.data?.tools.tools.map((tool) => tool.name)).toEqual(["get_transcript", "get_notes"]);
    const diagnostic = await tool.handler({ tool_query: "transcript", available_only: false });
    expect(diagnostic.data?.tools.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "delete_clip", registered: false }),
      expect.objectContaining({ name: "execute_extendscript", registered: false }),
    ]));
  });

  it("respects pack membership independently of authority", async () => {
    const tool = getHealthTools({}, resolveCapabilities("inspect,edit"), () => catalog,
      { toolPacks: resolveToolPacks("inspection") }).get_capabilities;
    expect((await tool.handler({ tool_query: "transcript" })).data?.tools.tools).toEqual([]);
    expect((await tool.handler({ tool_query: "delete_clip", available_only: false })).data?.tools.tools[0])
      .toMatchObject({ name: "delete_clip", registered: false, authority: { enabled: true } });
  });

  it("defaults search to 20 results and pages deterministically without duplicates", async () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) =>
      [`get_evidence_${String(i).padStart(2, "0")}`, { description: "Read evidence" }]));
    const tool = getHealthTools({}, resolveCapabilities("inspect"), () => many).get_capabilities;
    const first = await tool.handler({ tool_query: "evidence" });
    const second = await tool.handler({ tool_query: "evidence", tool_offset: 20 });
    expect(first.data?.tools.pagination).toMatchObject({ returned: 20, hasMore: true, nextOffset: 20 });
    expect(second.data?.tools.pagination).toMatchObject({ returned: 5, hasMore: false, nextOffset: null });
    const names = [...first.data!.tools.tools, ...second.data!.tools.tools].map((tool) => tool.name);
    expect(new Set(names).size).toBe(25);
    expect(names).toEqual(Object.keys(many));
    expect((await tool.handler({ tool_query: "no-match" })).data?.tools.pagination)
      .toMatchObject({ totalMatching: 0, hasMore: false, nextOffset: null });
  });

  it("preserves unfiltered legacy shape and rejects invalid search input", async () => {
    const tool = getHealthTools({}, resolveCapabilities("inspect"), () => catalog).get_capabilities;
    const legacy = await tool.handler({});
    expect(legacy.data?.tools.tools).toHaveLength(4);
    expect(legacy.data?.tools).not.toHaveProperty("pagination");
    expect(legacy.data?.tools.tools[0]).not.toHaveProperty("registered");
    for (const query of ["", "  ", "x".repeat(257)]) {
      expect(await tool.handler({ tool_query: query })).toMatchObject({ success: false });
    }
  });
});

describe("agent guidance over MCP", () => {
  it.each(["full", "inspection"])("matches discovery to tools/list in the %s pack", async (pack) => {
    vi.stubEnv("PREMIERE_MCP_CAPABILITIES", "inspect,edit,export,filesystem");
    vi.stubEnv("PREMIERE_MCP_TELEMETRY", "off");
    const server = createServer({}, { toolPacks: pack });
    const client = new Client({ name: "astra-discovery-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
      const result = await client.callTool({ name: "get_capabilities", arguments: {
        tool_query: "sequence", tool_limit: 128,
      } });
      const data = (result.structuredContent as any).data;
      expect(data.tools.tools.length).toBeGreaterThan(0);
      expect(data.discovery).toMatchObject({ detail: "summary" });
      expect(data.backends.uxp).not.toHaveProperty("apiCoverage");
      for (const tool of data.tools.tools) {
        expect(tool.registered).toBe(true);
        expect(listed.has(tool.name)).toBe(true);
      }
      const instructions = client.getInstructions()!;
      const resource = await client.readResource({ uri: "config://premiere-instructions" });
      expect(resource.contents[0]).toMatchObject({ text: instructions });
      expect(instructions).toContain("tool_query");
      expect(instructions).toContain("Serialize operations");
      expect(instructions).toContain("timeout can leave host outcome unknown");
      const routes = instructions.split("AVAILABLE WORKFLOW ROUTES:\n")[1].split("\n\nRECOVER")[0];
      for (const line of routes.split("\n")) {
        if (!line.includes(": ")) continue;
        for (const name of line.slice(2).split(": ")[0].split(" -> ")) {
          expect(listed.has(name), `${name} must be registered`).toBe(true);
        }
      }
      if (pack === "inspection") expect(routes).not.toContain("apply_edit_plan");
      else expect(routes).toContain("create_editorial_context_pack");
      if (pack === "full") {
        const legacy = await client.callTool({ name: "get_capabilities", arguments: {} });
        const search = await client.callTool({ name: "get_capabilities", arguments: {
          tool_query: "transcript", tool_limit: 10,
        } });
        expect(JSON.stringify(search).length).toBeLessThan(JSON.stringify(legacy).length / 4);
      }
      const invalid = await client.callTool({ name: "get_capabilities", arguments: { tool_query: "   " } });
      expect(invalid.isError).toBe(true);
      await expect(client.callTool({ name: "execute_extendscript", arguments: { script: "1" } }))
        .rejects.toThrow(/not found/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
