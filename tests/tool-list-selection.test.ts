import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer, resolveToolSelection } from "../src/server.js";

const quietTelemetry = { enabled: false, capture() {}, async shutdown() {} };

function readPackFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function listToolNames(toolList: string, toolPacks?: string): Promise<string[]> {
  const server = createServer({ timeoutMs: 50 }, { toolList, toolPacks, telemetry: quietTelemetry });
  const client = new Client({ name: "tool-list-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    return tools.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("PREMIERE_MCP_TOOL_LIST", () => {
  it("registers only the listed tools plus the two diagnostics", async () => {
    const names = await listToolNames("get_project_info,get_bin_contents,save_project");
    expect(names).toEqual(["get_bin_contents", "get_capabilities", "get_project_info", "ping", "save_project"]);
  });

  it("composes with a pack as a union", async () => {
    const essentialOnly = await listToolNames("", "essential");
    const withList = await listToolNames("create_bin", "essential");
    expect(essentialOnly).not.toContain("create_bin");
    expect(withList).toEqual([...essentialOnly, "create_bin"].sort());
  });

  it("refuses an unknown tool name at startup", () => {
    expect(() => resolveToolSelection({ timeoutMs: 50 }, { toolList: "get_project_info,not_a_tool" }))
      .toThrow(/PREMIERE_MCP_TOOL_LIST names 1 unknown tool\(s\): not_a_tool/);
    expect(() => createServer({ timeoutMs: 50 }, { toolList: "not_a_tool", telemetry: quietTelemetry }))
      .toThrow(/unknown tool/);
  });

  it("rejects unknown names even with the full catalog", () => {
    expect(() => resolveToolSelection({}, { toolPacks: "full", toolList: "not_a_tool" })).toThrow(/unknown tool/);
  });

  it("accepts UXP tool names without a UXP bridge and registers them only with one", async () => {
    const selection = resolveToolSelection({ timeoutMs: 50 }, { toolList: "manage_track_state_uxp,save_project" });
    expect(selection.explicitTools).toEqual(["manage_track_state_uxp", "save_project"]);
    const names = await listToolNames("manage_track_state_uxp,save_project");
    expect(names).toEqual(["get_capabilities", "ping", "save_project"]);
  });

  it("ships fork pack lists whose every name is a registered tool", async () => {
    for (const file of ["fork/packs/cleanup.txt", "fork/packs/turnover.txt"]) {
      const listed = readPackFile(file);
      expect(listed.length).toBeGreaterThanOrEqual(10);
      expect(listed.length).toBeLessThanOrEqual(15);
      expect(new Set(listed).size).toBe(listed.length);
      const selection = resolveToolSelection({ timeoutMs: 50 }, { toolList: listed.join(",") });
      expect(selection.explicitTools).toEqual(listed);
    }
    const cleanup = readPackFile("fork/packs/cleanup.txt");
    const names = await listToolNames(cleanup.join(","));
    expect(names).toEqual([...cleanup, "ping", "get_capabilities"].sort());
  });
});
