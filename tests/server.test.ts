import { describe, it, expect, vi, beforeEach } from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { createServer, SERVER_VERSION } from "../src/server.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

const { getDiscoveryTools } = vi.hoisted(() => ({
  getDiscoveryTools: vi.fn(() => ({
    mock_discovery_tool: {
      description: "A mock discovery tool",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name param" },
        },
        required: ["name"],
      },
      handler: vi.fn().mockResolvedValue({ success: true, data: { found: true } }),
    },
    mock_enum_tool: {
      description: "Enum validation fixture",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["normal", "multiply"] },
          operations: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["insert_clip", "remove_clip"] } } } },
        },
      },
      handler: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },
    // Report whether scripts built during the call would track Premiere's undo stack.
    get_mock_undo_tracking: {
      description: "Read-only mock",
      parameters: { type: "object", properties: {} },
      handler: async (args: Record<string, unknown>) => ({ success: true, data: { tracking: (await import("../src/bridge/undo-tracking.js")).undoTrackingEnabled(), guard: (await import("../src/bridge/project-guard.js")).expectedProjectPath(), args } }),
    },
    import_mock_undo_tracking: {
      description: "Filesystem-class mock (import_* tools add project items)",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ success: true, data: { tracking: (await import("../src/bridge/undo-tracking.js")).undoTrackingEnabled() } }),
    },
    set_mock_undo_tracking: {
      description: "Mutating mock",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        await Promise.resolve();
        return { success: true, data: { tracking: (await import("../src/bridge/undo-tracking.js")).undoTrackingEnabled() } };
      },
    },
  })),
}));

// Mock all tool modules to return simple tool definitions
vi.mock("../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
  withBridgeWorkflow: (_options: unknown, work: () => Promise<unknown>) => work(),
}));

// We need the real tool modules to verify registration,
// but mock sendCommand so handlers don't actually do file I/O
vi.mock("../src/tools/discovery.js", () => ({
  getDiscoveryTools,
}));

vi.mock("../src/tools/project.js", () => ({ getProjectTools: () => ({}) }));
vi.mock("../src/tools/media.js", () => ({ getMediaTools: () => ({}) }));
vi.mock("../src/tools/sequence.js", () => ({ getSequenceTools: () => ({}) }));
vi.mock("../src/tools/timeline.js", () => ({ getTimelineTools: () => ({}) }));
vi.mock("../src/tools/effects.js", () => ({ getEffectsTools: () => ({}) }));
vi.mock("../src/tools/transitions.js", () => ({ getTransitionsTools: () => ({}) }));
vi.mock("../src/tools/audio.js", () => ({ getAudioTools: () => ({}) }));
vi.mock("../src/tools/text.js", () => ({ getTextTools: () => ({}) }));
vi.mock("../src/tools/markers.js", () => ({ getMarkerTools: () => ({}) }));
vi.mock("../src/tools/tracks.js", () => ({ getTrackTools: () => ({}) }));
vi.mock("../src/tools/playhead.js", () => ({ getPlayheadTools: () => ({}) }));
vi.mock("../src/tools/metadata.js", () => ({ getMetadataTools: () => ({}) }));
vi.mock("../src/tools/export.js", () => ({ getExportTools: () => ({}) }));
vi.mock("../src/tools/media-analysis.js", () => ({ getMediaAnalysisTools: () => ({}) }));
vi.mock("../src/tools/interchange-analysis.js", () => ({ getInterchangeAnalysisTools: () => ({}) }));
vi.mock("../src/tools/advanced.js", () => ({ getAdvancedTools: () => ({}) }));
vi.mock("../src/tools/keyframes.js", () => ({ getKeyframeTools: () => ({}) }));
vi.mock("../src/tools/scripting.js", () => ({ getScriptingTools: () => ({}) }));
vi.mock("../src/tools/inspection.js", () => ({ getInspectionTools: () => ({}) }));
vi.mock("../src/tools/selection.js", () => ({ getSelectionTools: () => ({}) }));
vi.mock("../src/tools/clipboard.js", () => ({ getClipboardTools: () => ({}) }));
vi.mock("../src/tools/source-monitor.js", () => ({ getSourceMonitorTools: () => ({}) }));
vi.mock("../src/tools/track-targeting.js", () => ({ getTrackTargetingTools: () => ({}) }));
vi.mock("../src/tools/utility.js", () => ({ getUtilityTools: () => ({}) }));
vi.mock("../src/tools/health.js", () => ({ getHealthTools: () => ({}) }));
vi.mock("../src/tools/workspace.js", () => ({ getWorkspaceTools: () => ({}) }));
vi.mock("../src/tools/captions.js", () => ({ getCaptionTools: () => ({}) }));
vi.mock("../src/tools/playback.js", () => ({ getPlaybackTools: () => ({}) }));
vi.mock("../src/tools/project-manager.js", () => ({ getProjectManagerTools: () => ({}) }));
vi.mock("../src/resources/extendscript-reference.js", () => ({
  EXTENDSCRIPT_REFERENCE: "mock reference",
}));

describe("createServer", () => {
  it("returns an McpServer instance", () => {
    const server = createServer({});
    expect(server).toBeDefined();
    expect(typeof server.registerTool).toBe("function");
    expect(typeof server.registerResource).toBe("function");
    expect(typeof server.connect).toBe("function");
  });

  it("registers tools from all modules", () => {
    const toolSpy = vi.fn();
    const originalTool = createServer({}).registerTool;

    // Create a new server and spy on tool registration
    const server = createServer({});
    // The server should have been created successfully with registered tools
    expect(server).toBeDefined();
  });

  it("does not throw with empty bridge options", () => {
    expect(() => createServer({})).not.toThrow();
  });

  it("does not throw with custom bridge options", () => {
    expect(() =>
      createServer({ tempDir: "/custom/tmp", timeoutMs: 5000 })
    ).not.toThrow();
  });

  it("reuses immutable tool definitions for equivalent server configurations", () => {
    getDiscoveryTools.mockClear();
    const bridgeOptions = { tempDir: "/tmp/server-static-catalog-cache" };

    createServer(bridgeOptions);
    createServer(bridgeOptions);

    expect(getDiscoveryTools).toHaveBeenCalledTimes(1);
  });

  it("registers and serves the bounded live context resources", async () => {
    const server = createServer({});
    const client = new Client({ name: "live-resource-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
        "premiere://project/info",
        "premiere://project/sequences",
        "premiere://project/media",
        "premiere://project/bins",
        "premiere://timeline/active",
        "premiere://effects/available",
        "premiere://effects/applied",
        "premiere://transitions/available",
        "premiere://export/presets",
        "premiere://project/metadata",
      ]));

      const read = await client.readResource({ uri: "premiere://project/info" });
      expect(JSON.parse(read.contents[0].text as string)).toMatchObject({
        ok: true,
        resource: "premiere://project/info",
        resourceSchemaVersion: 1,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("jsonSchemaToInputSchema (tested via createServer)", () => {
  // We test the schema adapter indirectly by verifying the server
  // successfully registers tools with different parameter types.
  // The function is private, so we test through the public API.

  it("handles tools with string parameters", () => {
    // The mock_discovery_tool has a required string parameter.
    // If schema conversion fails, createServer would throw.
    expect(() => createServer({})).not.toThrow();
  });

  it("handles tools with no parameters", () => {
    // Many tools (health ping, etc.) have empty parameters.
    expect(() => createServer({})).not.toThrow();
  });
});

describe("SERVER_VERSION", () => {
  it("matches the version in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf-8"),
    );
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("is a concrete semver, never the 'unknown' fallback", () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("unknown tool arguments", () => {
  it("lists enum choices for top-level and nested array fields", async () => {
    const server = createServer({});
    const client = new Client({ name: "enum-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const outcome = await client.callTool({ name: "mock_enum_tool", arguments: { mode: "invalid", operations: [{ type: "invalid" }] } })
        .then((result) => (result.content as Array<{ text?: string }>).map((entry) => entry.text ?? "").join("\n"), (error: Error) => error.message);
      expect(outcome).toContain('allowed values: "normal", "multiply"');
      expect(outcome).toContain('allowed values: "insert_clip", "remove_clip"');
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("scopes the common project guard without passing it into module arguments", async () => {
    const server = createServer({});
    const client = new Client({ name: "project-guard-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.find((tool) => tool.name === "get_mock_undo_tracking")?.inputSchema.properties)
        .toHaveProperty("expected_project_path");
      const result = await client.callTool({ name: "get_mock_undo_tracking", arguments: { expected_project_path: "/target.prproj" } });
      expect(JSON.parse((result.content as { text: string }[])[0].text)).toMatchObject({ guard: "/target.prproj", args: {} });
    } finally {
      await client.close(); await server.close();
    }
  });

  it("rejects a misspelled argument by name instead of silently using defaults", async () => {
    const server = createServer({});
    const client = new Client({ name: "unknown-arg-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const outcome = await client.callTool({ name: "mock_discovery_tool", arguments: { name: "x", nmae: "y" } })
        .then((result) => JSON.stringify(result), (error: Error) => error.message);
      expect(outcome).toContain("unknown argument nmae; this tool accepts: name");
      const ok = await client.callTool({ name: "mock_discovery_tool", arguments: { name: "x" } });
      expect(ok.isError).toBeFalsy();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("compact schema profile", () => {
  async function connect(schemaProfile?: string) {
    const server = createServer({}, schemaProfile === undefined ? {} : { schemaProfile });
    const client = new Client({ name: "schema-profile-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return { server, client, close: async () => { await client.close(); await server.close(); } };
  }
  const guardOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    JSON.parse((result.content as { text: string }[])[0].text) as { guard?: string | null; args: Record<string, unknown> };

  it("omits the per-call guards from every listed tool and adds set_session_guard", async () => {
    const compact = await connect("compact");
    const full = await connect();
    try {
      const listed = (await compact.client.listTools()).tools;
      const mock = listed.find((tool) => tool.name === "get_mock_undo_tracking");
      expect(mock?.inputSchema.properties).not.toHaveProperty("expected_project_path");
      expect(mock?.inputSchema.properties).not.toHaveProperty("expected_cep_target");
      expect(listed.map((tool) => tool.name)).toContain("set_session_guard");
      const guardTool = listed.find((tool) => tool.name === "set_session_guard");
      expect(guardTool?.inputSchema.properties).toHaveProperty("expected_project_path");
      expect(guardTool?.inputSchema.properties).toHaveProperty("expected_cep_target");
      const fullListed = (await full.client.listTools()).tools;
      expect(fullListed.map((tool) => tool.name)).not.toContain("set_session_guard");
      const size = (tools: typeof listed, name: string) => JSON.stringify(tools.find((tool) => tool.name === name)?.inputSchema).length;
      expect(size(listed, "set_mock_undo_tracking")).toBeLessThan(size(fullListed, "set_mock_undo_tracking") - 2000);
    } finally {
      await compact.close();
      await full.close();
    }
  });

  it("still honors a per-call guard the listing omits and rejects a misspelled one", async () => {
    const { client, close } = await connect("compact");
    try {
      const result = await client.callTool({ name: "get_mock_undo_tracking", arguments: { expected_project_path: "/per-call.prproj" } });
      expect(guardOf(result)).toMatchObject({ guard: "/per-call.prproj", args: {} });
      const relative = await client.callTool({ name: "get_mock_undo_tracking", arguments: { expected_project_path: "relative.prproj" } })
        .then((value) => JSON.stringify(value), (error: Error) => error.message);
      expect(relative).toMatch(/expected_project_path|minLength|pattern|must/);
      const unknown = await client.callTool({ name: "mock_discovery_tool", arguments: { name: "x", expected_projekt_path: "/x.prproj" } })
        .then((value) => JSON.stringify(value), (error: Error) => error.message);
      expect(unknown).toContain("unknown argument expected_projekt_path");
    } finally {
      await close();
    }
  });

  it("applies the session guard to later calls, lets a per-call value override, and clears", async () => {
    const { client, close } = await connect("compact");
    try {
      const unguarded = await client.callTool({ name: "get_mock_undo_tracking", arguments: {} });
      expect(guardOf(unguarded).guard ?? null).toBeNull();
      const set = await client.callTool({ name: "set_session_guard", arguments: { expected_project_path: "/session.prproj" } });
      expect(set.isError).toBeFalsy();
      const guarded = await client.callTool({ name: "get_mock_undo_tracking", arguments: {} });
      expect(guardOf(guarded)).toMatchObject({ guard: "/session.prproj", args: {} });
      const overridden = await client.callTool({ name: "get_mock_undo_tracking", arguments: { expected_project_path: "/override.prproj" } });
      expect(guardOf(overridden)).toMatchObject({ guard: "/override.prproj", args: {} });
      const cleared = await client.callTool({ name: "set_session_guard", arguments: { clear: true } });
      expect(cleared.isError).toBeFalsy();
      const after = await client.callTool({ name: "get_mock_undo_tracking", arguments: {} });
      expect(guardOf(after).guard ?? null).toBeNull();
    } finally {
      await close();
    }
  });

  it("keeps the session guard per server instance", async () => {
    const first = await connect("compact");
    const second = await connect("compact");
    try {
      await first.client.callTool({ name: "set_session_guard", arguments: { expected_project_path: "/first.prproj" } });
      const other = await second.client.callTool({ name: "get_mock_undo_tracking", arguments: {} });
      expect(guardOf(other).guard ?? null).toBeNull();
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("rejects compact guards for request-scoped HTTP servers", () => {
    expect(() => createServer({}, { schemaProfile: "compact", statelessHttp: true }))
      .toThrow(/unavailable on stateless HTTP/);
    expect(() => createServer({}, { schemaProfile: "full", statelessHttp: true })).not.toThrow();
  });

  it("hashes effective session guards and honors equivalent per-call overrides", async () => {
    const { client, close } = await connect("compact");
    try {
      await client.callTool({ name: "set_session_guard", arguments: { expected_project_path: "/a.prproj" } });
      const argumentsA = { idempotency_key: "guard-snapshot" };
      const first = await client.callTool({ name: "set_mock_undo_tracking", arguments: argumentsA });
      expect(first.isError).toBeFalsy();
      await client.callTool({ name: "set_session_guard", arguments: { expected_project_path: "/b.prproj" } });
      const changed = await client.callTool({ name: "set_mock_undo_tracking", arguments: argumentsA });
      expect(JSON.stringify(changed)).toContain("IDEMPOTENCY_KEY_REUSED");
      const equivalent = await client.callTool({ name: "set_mock_undo_tracking", arguments: { ...argumentsA, expected_project_path: "/a.prproj" } });
      expect(equivalent.isError).toBeFalsy();
      expect(JSON.stringify(equivalent)).toContain('"replayed":true');
      await client.callTool({ name: "set_session_guard", arguments: { clear: true } });
      const cleared = await client.callTool({ name: "set_mock_undo_tracking", arguments: argumentsA });
      expect(JSON.stringify(cleared)).toContain("IDEMPOTENCY_KEY_REUSED");
    } finally {
      await close();
    }
  });

  it("refuses an unknown profile at construction", () => {
    expect(() => createServer({}, { schemaProfile: "tiny" })).toThrow(/Unknown Premiere MCP schema profile/);
  });
});

describe("undo tracking is scoped to tools that change the project", () => {
  it("tracks for a mutating tool and not for a read-only one", async () => {
    const server = createServer({});
    const client = new Client({ name: "undo-scope-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const read = await client.callTool({ name: "get_mock_undo_tracking", arguments: {} });
      const write = await client.callTool({ name: "set_mock_undo_tracking", arguments: {} });
      expect(read.structuredContent).toMatchObject({ data: { tracking: false } });
      expect(write.structuredContent).toMatchObject({ data: { tracking: true } });
      const imported = await client.callTool({ name: "import_mock_undo_tracking", arguments: {} });
      expect(imported.structuredContent).toMatchObject({ data: { tracking: true } });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
