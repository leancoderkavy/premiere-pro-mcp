import { describe, expect, it } from "vitest";
import { WORKFLOW_CATALOG, WORKFLOW_PROMPTS, WORKFLOW_RESOURCE } from "../src/workflows/catalog.js";
import { annotationsForTool, structuredToolResult } from "../src/workflows/tool-metadata.js";
import { createServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("modern MCP surface", () => {
  it("publishes focused workflow prompts with inspection and verification guidance", () => {
    expect(WORKFLOW_PROMPTS).toHaveLength(WORKFLOW_CATALOG.length);
    expect(new Set(WORKFLOW_PROMPTS.map((prompt) => prompt.name)).size).toBe(WORKFLOW_PROMPTS.length);

    const rendered = WORKFLOW_PROMPTS[0].render({ goal: "Create a 30 second teaser" });
    expect(rendered.messages[0].content.text).toContain("Begin with project inspection");
    expect(rendered.messages[0].content.text).toContain("inspect the result");
  });

  it("exposes a machine-readable workflow resource", () => {
    const resource = JSON.parse(WORKFLOW_RESOURCE);
    expect(resource.version).toBe(1);
    expect(resource.workflows).toHaveLength(4);
    expect(resource.workflows[0].recommendedTools).toContain("get_premiere_state");
  });

  it("marks inspection as read-only and script execution as open-world", () => {
    expect(annotationsForTool("get_project_info")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(annotationsForTool("delete_bin")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(annotationsForTool("execute_extendscript").openWorldHint).toBe(true);
  });

  it("builds stable structured result envelopes", () => {
    expect(structuredToolResult("ping", true, { ready: true })).toEqual({
      ok: true,
      tool: "ping",
      data: { ready: true },
    });
    expect(structuredToolResult("save_project", false, undefined, "offline")).toEqual({
      ok: false,
      tool: "save_project",
      error: "offline",
    });
  });

  it("advertises prompts, resources, and tool annotations over MCP", async () => {
    const server = createServer({ timeoutMs: 50 });
    const client = new Client({ name: "modernization-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toContain("premiere-rough-cut");

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toContain("config://premiere-workflows");

      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "get_project_info")?.annotations?.readOnlyHint).toBe(true);
      expect(tools.tools.map((tool) => tool.name)).toContain("get_capabilities");
      expect(tools.tools).toHaveLength(269);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
