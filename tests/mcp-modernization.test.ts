import { describe, expect, it } from "vitest";
import { WORKFLOW_CATALOG, WORKFLOW_PROMPTS, WORKFLOW_RESOURCE } from "../src/workflows/catalog.js";
import { annotationsForTool, structuredToolResult } from "../src/workflows/tool-metadata.js";
import { createServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Telemetry, TelemetryProperties } from "../src/telemetry.js";

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
    expect(resource.workflows).toHaveLength(10);
    expect(resource.workflows[0].recommendedTools).toContain("get_premiere_state");
    const organization = resource.workflows.find((workflow: { id: string }) => workflow.id === "project-organization");
    expect(organization.recommendedTools).toContain("apply_editorial_organization_plan");
    expect(organization.recommendedTools).not.toContain("organize_project_items_uxp");
    expect(organization.summary).toContain("advanced/manual only");
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
    expect(annotationsForTool("search_project_context")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool("create_context_edit_plan")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool("create_editorial_plan")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool("preview_editorial_plan")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool("apply_editorial_organization_plan")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(annotationsForTool("manage_project_context")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    for (const name of ["list_bins", "inspect_clip", "find_media", "check_project"]) {
      expect(annotationsForTool(name)).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    }
    for (const name of ["remove_clip", "ripple_delete_clip", "close_project"]) {
      expect(annotationsForTool(name).destructiveHint).toBe(true);
    }
    expect(annotationsForTool("send_raw_script").openWorldHint).toBe(true);
    expect(annotationsForTool("save_project")).toMatchObject({
      title: "Save Project",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
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
    expect(structuredToolResult("ping", true)).toEqual({ ok: true, tool: "ping", data: null });
    expect(structuredToolResult("ping", false)).toEqual({ ok: false, tool: "ping", error: "Unknown error" });
  });

  it("renders optional workflow constraints", () => {
    const rendered = WORKFLOW_PROMPTS[1].render({ goal: "clean dialogue", constraints: "preserve room tone" });
    expect(rendered.messages[0].content.text).toContain("Constraints: preserve room tone");
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
      expect(resources.resources.map((resource) => resource.uri)).toContain("config://premiere-project-context");

      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "get_project_info")?.annotations?.readOnlyHint).toBe(true);
      expect(tools.tools.map((tool) => tool.name)).toContain("get_capabilities");
      // The default profile grants inspect/edit/export/filesystem but not
      // unsafe-script, so the two scripting tools are not advertised.
      expect(tools.tools.map((tool) => tool.name)).not.toContain("execute_extendscript");
      expect(tools.tools.map((tool) => tool.name)).not.toContain("evaluate_expression");
      expect(tools.tools).toHaveLength(285);
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "manage_project_context",
        "search_project_context",
        "create_context_edit_plan",
        "create_editorial_plan",
        "preview_editorial_plan",
      ]));

      const capabilities = await client.callTool({
        name: "get_capabilities",
        arguments: {},
      });
      const capabilityData = (capabilities.structuredContent as any).data;
      expect(capabilityData.tools.generatedFrom).toBe("registered-tool-catalog");
      // The catalog intentionally reports every tool that exists — including
      // ones this profile disables, each flagged with its authority state — so
      // it is a superset of what tools/list advertises.
      expect(capabilityData.tools.total).toBeGreaterThanOrEqual(tools.tools.length);
      expect(capabilityData.tools.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(tools.tools.map((tool) => tool.name)),
      );
      expect(
        capabilityData.tools.tools.find((tool: any) => tool.name === "execute_extendscript")
          ?.authority,
      ).toMatchObject({ required: "unsafe-script", enabled: false });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("records bounded tool usage without arguments or result content", async () => {
    const events: Array<{ event: string; properties?: TelemetryProperties }> = [];
    const telemetry: Telemetry = {
      enabled: true,
      capture: (event, properties) => events.push({ event, properties }),
      shutdown: async () => {},
    };
    const server = createServer({ timeoutMs: 50 }, { telemetry });
    const client = new Client({ name: "telemetry-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({
        name: "get_capabilities",
        arguments: {},
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: "mcp_tool_call",
        properties: {
          tool: "get_capabilities",
          outcome: "succeeded",
        },
      });
      expect(events[0].properties).not.toHaveProperty("arguments");
      expect(events[0].properties).not.toHaveProperty("result");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
