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
 *                      binds 0.0.0.0 and can drive Premiere.
 *   MCP_MAX_REQUEST_BYTES, MCP_*_TIMEOUT_MS, MCP_RATE_LIMIT_* and
 *   MCP_MAX_CONCURRENT_REQUESTS bound public HTTP resource use. See README.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { getTelemetry } from "./telemetry.js";
import { applyHttpSecurityHeaders } from "./http-security.js";
import {
  HttpAdmissionController,
  MCP_HTTP_METHODS,
  exceedsRequestBodyLimit,
  getRequestPathname,
  isAuthorizedBearer,
  isSupportedMcpMethod,
  readBoundedRequestBody,
  rateLimitIdentity,
  readHttpAdmissionSettings,
  readHttpAuthConfiguration,
  RequestBodyTooLargeError,
} from "./http-admission.js";

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

function cacheControlForLandingAsset(urlPath: string, contentType: string): string {
  if (contentType.startsWith("text/html")) return "no-cache, must-revalidate";
  if (urlPath.startsWith("/_next/static/")) return "public, max-age=31536000, immutable";
  return "public, max-age=86400, stale-while-revalidate=604800";
}

function injectScriptNonce(document: string, nonce: string): string {
  return document.replace(/<script(?=\s|>)/gi, `<script nonce="${nonce}"`);
}

function serveLanding(req: http.IncomingMessage, res: http.ServerResponse, scriptNonce: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
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
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControlForLandingAsset(urlPath, contentType),
  };

  // A static export cannot generate per-request nonces itself. Add the nonce
  // at the trusted server boundary so Next bootstrap and JSON-LD scripts remain
  // executable without retaining script-src 'unsafe-inline'.
  if (contentType.startsWith("text/html")) {
    try {
      const document = injectScriptNonce(fs.readFileSync(filePath, "utf8"), scriptNonce);
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : document);
      return true;
    } catch (error) {
      console.error("[premiere-pro-mcp] Landing document read failed:", error);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Internal server error");
      return true;
    }
  }

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
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else stream.pipe(res);
  return true;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
let httpAuth: ReturnType<typeof readHttpAuthConfiguration>;
let admissionSettings: ReturnType<typeof readHttpAdmissionSettings>;
try {
  httpAuth = readHttpAuthConfiguration(process.env);
  admissionSettings = readHttpAdmissionSettings(process.env);
} catch (error) {
  console.error("[premiere-pro-mcp] Refusing to start:", error instanceof Error ? error.message : error);
  process.exit(1);
  throw error;
}

const bridgeOptions = {
  tempDir: process.env.PREMIERE_TEMP_DIR,
  timeoutMs: process.env.PREMIERE_TIMEOUT_MS
    ? parseInt(process.env.PREMIERE_TIMEOUT_MS, 10)
    : undefined,
};
process.env.PREMIERE_MCP_TRANSPORT = "http";
const telemetry = getTelemetry();
const admission = new HttpAdmissionController(admissionSettings);

const tempDir = getTempDir(bridgeOptions);
console.error(`[premiere-pro-mcp] Starting HTTP server on port ${PORT}...`);
console.error(`[premiere-pro-mcp] Temp directory: ${tempDir}`);
cleanupTempDir(bridgeOptions);

// Each request gets its own transport+server instance (stateless per-request model)
const httpServer = http.createServer(async (req, res) => {
  const scriptNonce = randomBytes(18).toString("base64");
  applyHttpSecurityHeaders(res, { scriptNonce });
  const pathname = getRequestPathname(req.url);

  if (!pathname) {
    res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Malformed request URL" }));
    return;
  }

  // Health check
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: "premiere-pro-mcp", admission: admission.metrics() }));
    return;
  }

  // Only handle /mcp endpoint; everything else goes to the landing page
  if (pathname !== "/mcp") {
    if (serveLanding(req, res, scriptNonce)) return;
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (!isSupportedMcpMethod(req.method)) {
    res.writeHead(405, { "Allow": MCP_HTTP_METHODS.join(", "), "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (exceedsRequestBodyLimit(req, admissionSettings.maxRequestBytes)) {
    telemetry.capture("mcp_request_rejected", { outcome: "request_too_large", status_code: 413 });
    res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Request body too large" }));
    return;
  }

  // Bearer token auth is fail-closed in production. The comparison is constant
  // time for equal-length credentials and never records the provided header.
  if (!isAuthorizedBearer(req, httpAuth.authToken)) {
    telemetry.capture("mcp_connection_attempt", {
      outcome: "unauthorized",
      method: req.method ?? "unknown",
    });
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const admissionDecision = admission.acquire(rateLimitIdentity(req, httpAuth.authToken, admissionSettings.trustProxy));
  if (!admissionDecision.accepted) {
    telemetry.capture("mcp_request_rejected", {
      outcome: admissionDecision.reason,
      status_code: admissionDecision.statusCode,
    });
    res.writeHead(admissionDecision.statusCode, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(admissionDecision.retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: admissionDecision.reason === "rate_limited" ? "Too many requests" : "Service busy" }));
    return;
  }

  let parsedBody: unknown;
  if (req.method !== "GET") {
    try {
      const body = await readBoundedRequestBody(req, admissionSettings.maxRequestBytes);
      // Passing an already-parsed body prevents the transport from reading the
      // Node stream a second time. `null` represents a deliberately empty POST.
      parsedBody = body.length === 0 ? null : JSON.parse(body.toString("utf8"));
    } catch (error) {
      admissionDecision.release();
      if (error instanceof RequestBodyTooLargeError) {
        telemetry.capture("mcp_request_rejected", { outcome: "request_too_large", status_code: 413 });
        res.writeHead(413, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
        res.end(JSON.stringify({ error: "Request body too large" }));
        return;
      }
      telemetry.capture("mcp_request_rejected", { outcome: "invalid_json", status_code: 400 });
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: Invalid JSON-RPC message" },
        id: null,
      }));
      return;
    }
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
    admissionDecision.release();
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
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

httpServer.headersTimeout = admissionSettings.headersTimeoutMs;
httpServer.requestTimeout = admissionSettings.requestTimeoutMs;
httpServer.keepAliveTimeout = admissionSettings.keepAliveTimeoutMs;
httpServer.maxRequestsPerSocket = admissionSettings.maxRequestsPerSocket;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`[premiere-pro-mcp] HTTP server listening on 0.0.0.0:${PORT}`);
  console.error(`[premiere-pro-mcp] MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  if (httpAuth.authToken) {
    console.error(`[premiere-pro-mcp] Auth: Bearer token required`);
  } else {
    console.error(`[premiere-pro-mcp] Auth: disabled outside production for an explicit local/test override`);
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
