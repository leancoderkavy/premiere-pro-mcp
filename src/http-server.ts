#!/usr/bin/env node

/**
 * HTTP/SSE transport entry point for remote deployment (e.g. Fly.io).
 *
 * The MCP server is identical to the stdio version — only the transport differs.
 * Clients connect via the MCP Streamable HTTP transport:
 *   POST /mcp  — send JSON-RPC messages
 *   GET  /mcp  — open SSE stream
 *
 * The bridge still uses the local filesystem temp directory, so the CEP plugin
 * must be reachable from the same machine OR you must set PREMIERE_TEMP_DIR to
 * a shared volume mount that the CEP plugin also writes to.
 *
 * Environment variables:
 *   PORT               HTTP port to listen on (default: 3000)
 *   PREMIERE_TEMP_DIR  Shared temp directory for the file bridge
 *   PREMIERE_TIMEOUT_MS Command timeout in ms (default: 30000)
 *   MCP_AUTH_TOKEN     Optional bearer token to require on all requests
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.resolve(__dirname, "../landing-dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain",
};

function serveLanding(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!fs.existsSync(LANDING_DIR)) return false;

  let urlPath = req.url?.split("?")[0] ?? "/";
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  // Next.js trailingSlash: /about/ -> /about/index.html
  if (urlPath.endsWith("/")) urlPath += "index.html";

  const filePath = path.join(LANDING_DIR, urlPath);
  // Security: ensure we stay within LANDING_DIR
  if (!filePath.startsWith(LANDING_DIR)) return false;

  if (!fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

const bridgeOptions = {
  tempDir: process.env.PREMIERE_TEMP_DIR,
  timeoutMs: process.env.PREMIERE_TIMEOUT_MS
    ? parseInt(process.env.PREMIERE_TIMEOUT_MS, 10)
    : undefined,
};

const tempDir = getTempDir(bridgeOptions);
console.error(`[premiere-pro-mcp] Starting HTTP server on port ${PORT}...`);
console.error(`[premiere-pro-mcp] Temp directory: ${tempDir}`);
cleanupTempDir(bridgeOptions);

// Each request gets its own transport+server instance (stateless per-request model)
const httpServer = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "premiere-pro-mcp" }));
    return;
  }

  // Only handle /mcp endpoint; everything else goes to the landing page
  if (!req.url?.startsWith("/mcp")) {
    if (serveLanding(req, res)) return;
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // Optional bearer token auth
  if (AUTH_TOKEN) {
    const authHeader = req.headers["authorization"] ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (provided !== AUTH_TOKEN) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  const mcpServer = createServer(bridgeOptions);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[premiere-pro-mcp] Request error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`[premiere-pro-mcp] HTTP server listening on 0.0.0.0:${PORT}`);
  console.error(`[premiere-pro-mcp] MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  if (AUTH_TOKEN) {
    console.error(`[premiere-pro-mcp] Auth: Bearer token required`);
  } else {
    console.error(`[premiere-pro-mcp] Auth: none (set MCP_AUTH_TOKEN to enable)`);
  }
});

process.on("SIGTERM", () => {
  console.error("[premiere-pro-mcp] SIGTERM received, shutting down...");
  httpServer.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.error("[premiere-pro-mcp] SIGINT received, shutting down...");
  httpServer.close(() => process.exit(0));
});
