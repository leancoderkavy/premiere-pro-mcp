import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("MCP 2026-07-28 protocol entry", () => {
  it("negotiates the modern era and emits routing and cache metadata", async () => {
    const observed: Array<{ method?: string; name?: string; version?: string }> = [];
    const handler = createMcpHandler(() => createServer({ timeoutMs: 25 }));
    const nodeHandler = toNodeHandler(handler);
    const server = http.createServer((req, res) => {
      observed.push({
        method: req.headers["mcp-method"] as string | undefined,
        name: req.headers["mcp-name"] as string | undefined,
        version: req.headers["mcp-protocol-version"] as string | undefined,
      });
      void nodeHandler(req, res);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test address");

    const client = new Client(
      { name: "premiere-modern-protocol-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    closers.push(async () => {
      await client.close().catch(() => {});
      await handler.close().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    await client.connect(transport);
    expect(client.getProtocolEra()).toBe("modern");

    const capabilities = client.getServerCapabilities();
    expect(capabilities?.extensions?.["io.github.leancoderkavy/premiere-pro"]).toMatchObject({
      protocolRevision: "2026-07-28",
      dualEra: true,
    });

    const tools = await client.listTools();
    expect(tools.ttlMs).toBe(30_000);
    expect(tools.cacheScope).toBe("private");
    expect(tools.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "get_capabilities" }),
    ]));

    const result = await client.callTool({ name: "get_capabilities", arguments: {} });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        mcp: {
          protocol: { modernRevision: "2026-07-28", dualEra: true },
        },
      },
    });

    expect(observed).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "tools/list", version: "2026-07-28" }),
      expect.objectContaining({ method: "tools/call", name: "get_capabilities", version: "2026-07-28" }),
    ]));
  });
});
