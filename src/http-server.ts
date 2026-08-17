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
 *   MCP_AUTH_TOKEN     Bearer token required on every /mcp request. REQUIRED — the
 *                      server refuses to start without it, because this transport
 *                      binds 0.0.0.0 and can drive Premiere. Set ALLOW_UNAUTHENTICATED=1
 *                      only for a deliberately public, throwaway instance.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { getTelemetry } from "./telemetry.js";
import { applyHttpSecurityHeaders } from "./http-security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.resolve(__dirname, "../landing-dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".mp4":  "video/mp4",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain",
  ".xml":  "application/xml",
};

function serveLanding(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!fs.existsSync(LANDING_DIR)) return false;

  let urlPath: string;
  try {
    urlPath = decodeURIComponent(req.url?.split("?")[0] ?? "/");
  } catch {
    return false;
  }
  const requestedSegments = urlPath.split("/").filter(Boolean);
  const safeSegments = requestedSegments.map((segment) => path.basename(segment));
  if (safeSegments.some((segment, index) => (
    segment !== requestedSegments[index] ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\\") ||
    segment.includes("\0")
  ))) return false;
  // Next.js trailingSlash exports /about/ as /about/index.html.
  if (urlPath.endsWith("/") || safeSegments.length === 0) safeSegments.push("index.html");

  let filePath = path.join(LANDING_DIR, ...safeSegments);
  // Security: ensure we stay within LANDING_DIR
  const relativePath = path.relative(LANDING_DIR, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) return false;

  if (!fs.existsSync(filePath)) return false;

  let fileStats: fs.Stats;
  try {
    fileStats = fs.statSync(filePath);
    // Accept extensionless Next.js routes such as /changelog without trying to
    // stream the directory itself. Streaming a directory emits an unhandled
    // EISDIR error on Linux and previously restarted the production process.
    if (fileStats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) return false;
      fileStats = fs.statSync(filePath);
    }
  } catch {
    return false;
  }
  if (!fileStats.isFile()) return false;

  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  const stream = fs.createReadStream(filePath);
  stream.once("error", (error) => {
    console.error("[premiere-pro-mcp] Landing asset read failed:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal server error");
      return;
    }
    res.destroy();
  });
  res.writeHead(200, { "Content-Type": contentType });
  stream.pipe(res);
  return true;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const ALLOW_UNAUTHENTICATED = process.env.ALLOW_UNAUTHENTICATED === "1";

// Fail closed. This transport listens on 0.0.0.0 and every /mcp request can drive
// Premiere, so starting it wide open is almost never what anyone means to do. Refuse
// unless a token is set, or the operator has explicitly opted into a public instance.
if (!AUTH_TOKEN && !ALLOW_UNAUTHENTICATED) {
  console.error(
    "[premiere-pro-mcp] Refusing to start: MCP_AUTH_TOKEN is not set.\n" +
      "  This HTTP transport is remotely reachable and can control Premiere.\n" +
      "  Set MCP_AUTH_TOKEN to a strong secret, or set ALLOW_UNAUTHENTICATED=1 if you\n" +
      "  genuinely want a public, unauthenticated instance."
  );
  process.exit(1);
}

/** Constant-time bearer check, so token comparison leaks no timing signal. */
function isAuthorized(req: http.IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true; // only reachable under ALLOW_UNAUTHENTICATED
  const header = req.headers["authorization"] ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(provided);
  const b = Buffer.from(AUTH_TOKEN);
  // timingSafeEqual throws on length mismatch, which would itself leak length — so
  // guard the length check first and only compare equal-length buffers.
  return a.length === b.length && timingSafeEqual(a, b);
}

const bridgeOptions = {
  tempDir: process.env.PREMIERE_TEMP_DIR,
  timeoutMs: process.env.PREMIERE_TIMEOUT_MS
    ? parseInt(process.env.PREMIERE_TIMEOUT_MS, 10)
    : undefined,
};
process.env.PREMIERE_MCP_TRANSPORT = "http";
const telemetry = getTelemetry();

const tempDir = getTempDir(bridgeOptions);
console.error(`[premiere-pro-mcp] Starting HTTP server on port ${PORT}...`);
console.error(`[premiere-pro-mcp] Temp directory: ${tempDir}`);
cleanupTempDir(bridgeOptions);

// Each request gets its own transport+server instance (stateless per-request model)
const httpServer = http.createServer(async (req, res) => {
  applyHttpSecurityHeaders(res);

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

  // Bearer token auth (constant-time; required unless ALLOW_UNAUTHENTICATED=1)
  if (!isAuthorized(req)) {
    telemetry.capture("mcp_connection_attempt", {
      outcome: "unauthorized",
      method: req.method ?? "unknown",
    });
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const requestStartedAt = Date.now();
  telemetry.capture("mcp_connection_attempt", {
    outcome: "authorized",
    method: req.method ?? "unknown",
  });
  const mcpServer = createServer(bridgeOptions, { telemetry });
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
    telemetry.capture("mcp_request", {
      outcome: res.statusCode >= 400 ? "failed" : "succeeded",
      method: req.method ?? "unknown",
      status_code: res.statusCode,
      duration_ms: Date.now() - requestStartedAt,
    });
  } catch (err) {
    telemetry.capture("mcp_request", {
      outcome: "failed",
      method: req.method ?? "unknown",
      status_code: 500,
      duration_ms: Date.now() - requestStartedAt,
      error_type: err instanceof Error ? err.name : "UnknownError",
    });
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
    console.error(`[premiere-pro-mcp] Auth: DISABLED via ALLOW_UNAUTHENTICATED — anyone can drive this server`);
  }
});

async function shutdown(signal: string) {
  console.error(`[premiere-pro-mcp] ${signal} received, shutting down...`);
  httpServer.close();
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
