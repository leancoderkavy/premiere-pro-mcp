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
 *   MCP_HTTP_HOST      Listen address (default: 0.0.0.0; use 127.0.0.1 for local tests)
 *   PREMIERE_TEMP_DIR  Shared temp directory for the file bridge
 *   PREMIERE_TIMEOUT_MS Command timeout in ms (default: 30000)
 *   MCP_AUTH_TOKEN     Bearer token required on every /mcp request. REQUIRED — the
 *                      server refuses to start without it, because this transport
 *                      binds 0.0.0.0 by default and can drive Premiere.
 *   MCP_OAUTH_*        Alternatively configure an OAuth issuer, JWKS URI,
 *                      audience, public URL, and required scopes for per-user auth.
 *   MCP_MAX_REQUEST_BYTES, MCP_*_TIMEOUT_MS, MCP_RATE_LIMIT_*,
 *   MCP_MAX_CONCURRENT_REQUESTS, and MCP_MAX_CONCURRENT_STREAMS bound public
 *   HTTP resource use. See README.
 */

import http from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, SERVER_VERSION } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { getTelemetry, telemetryErrorType } from "./telemetry.js";
import { applyHttpSecurityHeaders } from "./http-security.js";
import { OAuthResourceServer } from "./oauth-resource-server.js";
import { ProjectContextRepository } from "./context/project-context-store.js";
import { MediaWatchRegistry } from "./tools/media-watch.js";
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

/**
 * The product website lives in its own repository and is served from
 * https://premiere-pro-mcp.com. This process only serves MCP, health, and
 * OAuth discovery. Browser traffic that reaches a known public alias of the
 * hosted deployment is sent to the website; every other host gets a plain 404.
 */
const PUBLIC_SITE_ORIGIN = "https://premiere-pro-mcp.com";

function isPublicSiteAlias(hostHeader: string | undefined): boolean {
  // Only the Host header is consulted; forwarded host headers are never trusted.
  const hostname = hostHeader?.trim().toLowerCase().replace(/:\d+$/, "");
  if (!hostname) return false;
  return hostname === "premiere-pro-mcp.fly.dev" || hostname.endsWith(".premiere-pro-mcp.com");
}

function publicSiteLocation(rawUrl: string): string {
  // Parse against a fixed base so absolute-form and protocol-relative request
  // targets can never change the redirect origin.
  const url = new URL(rawUrl, "http://localhost");
  return `${PUBLIC_SITE_ORIGIN}${url.pathname}${url.search}`;
}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HTTP_HOST = process.env.MCP_HTTP_HOST || "0.0.0.0";
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
const preAuthAdmission = new HttpAdmissionController(admissionSettings);
const oauthResourceServer = httpAuth.oauth ? new OAuthResourceServer(httpAuth.oauth) : undefined;
// Streamable HTTP creates an McpServer for every request. Sharing the repository
// keeps memory-backed context durable across those request-scoped servers and
// avoids repeatedly opening the same JSON or SQLite store.
const projectContextRepository = new ProjectContextRepository();
const mediaWatchRegistry = new MediaWatchRegistry();
const mcpHandler = createMcpHandler(
  () => createServer(bridgeOptions, { telemetry, contextRepository: projectContextRepository, mediaWatchRegistry }),
  {
    onerror: (error) => console.error("[premiere-pro-mcp] MCP handler error:", error),
  },
);
const handleMcpRequest = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error("[premiere-pro-mcp] MCP Node adapter error:", error),
});

const tempDir = getTempDir(bridgeOptions);
console.error(`[premiere-pro-mcp] Starting HTTP server on port ${PORT}...`);
console.error(`[premiere-pro-mcp] Temp directory: ${tempDir}`);
cleanupTempDir(bridgeOptions);

// Each request gets its own transport+server instance (stateless per-request model)
const httpServer = http.createServer(async (req, res) => {
  applyHttpSecurityHeaders(res);
  const pathname = getRequestPathname(req.url);

  if (!pathname) {
    res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Malformed request URL" }));
    return;
  }

  // Health check
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: "premiere-pro-mcp", version: SERVER_VERSION }));
    return;
  }

  if (
    req.method === "GET" &&
    (pathname === "/.well-known/oauth-protected-resource" ||
      pathname === "/.well-known/oauth-protected-resource/mcp") &&
    oauthResourceServer
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    });
    res.end(JSON.stringify(oauthResourceServer.metadata()));
    return;
  }

  // Only /mcp reaches the MCP transport. Website paths on a public alias go to
  // the website; everything else is a small 404.
  if (pathname !== "/mcp") {
    if ((req.method === "GET" || req.method === "HEAD") && isPublicSiteAlias(req.headers.host)) {
      res.writeHead(308, {
        "Location": publicSiteLocation(req.url!),
        "Cache-Control": "public, max-age=3600",
      });
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ error: "Not found" }));
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

  // OAuth access tokens are verified for issuer, audience, lifetime, signature,
  // subject, and scope. The legacy shared token remains available for controlled
  // single-operator deployments and is compared in constant time.
  // Apply an IP-keyed gate first so untrusted JWT/JWKS work cannot bypass the
  // same concurrency and rate bounds that protect authenticated requests.
  const preAuthDecision = preAuthAdmission.acquire(rateLimitIdentity(req, admissionSettings.trustProxy));
  if (!preAuthDecision.accepted) {
    telemetry.capture("mcp_request_rejected", {
      outcome: preAuthDecision.reason,
      status_code: preAuthDecision.statusCode,
      phase: "pre_auth",
    });
    res.writeHead(preAuthDecision.statusCode, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(preAuthDecision.retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: preAuthDecision.reason === "rate_limited" ? "Too many requests" : "Service busy" }));
    return;
  }

  let oauthAuthentication: Awaited<ReturnType<OAuthResourceServer["authenticate"]>> | undefined;
  try {
    oauthAuthentication = oauthResourceServer
      ? await oauthResourceServer.authenticate(req)
      : undefined;
  } finally {
    preAuthDecision.release();
  }
  const isAuthorized = oauthAuthentication
    ? oauthAuthentication.authenticated
    : isAuthorizedBearer(req, httpAuth.authToken);
  if (!isAuthorized) {
    telemetry.capture("mcp_connection_attempt", {
      outcome: "unauthorized",
      method: req.method ?? "unknown",
    });
    const challenge = oauthResourceServer
      ? oauthResourceServer.challenge(oauthAuthentication?.authenticated === false ? oauthAuthentication.error : undefined)
      : "Bearer";
    const statusCode = oauthAuthentication?.authenticated === false && oauthAuthentication.error === "insufficient_scope"
      ? 403
      : 401;
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "WWW-Authenticate": challenge,
    });
    res.end(JSON.stringify({ error: statusCode === 403 ? "Forbidden" : "Unauthorized" }));
    return;
  }

  const authenticatedIdentity = oauthAuthentication?.authenticated
    ? `oauth:${oauthAuthentication.principal.rateLimitKey}`
    : "credential:shared-operator";
  const admissionDecision = admission.acquire(
    authenticatedIdentity,
    req.method === "GET" ? "stream" : "operation",
  );
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
  res.on("close", () => {
    admissionDecision.release();
  });

  try {
    await handleMcpRequest(req, res, parsedBody);
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
      error_type: telemetryErrorType(err),
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

httpServer.listen(PORT, HTTP_HOST, () => {
  console.error(`[premiere-pro-mcp] HTTP server listening on ${HTTP_HOST}:${PORT}`);
  console.error(`[premiere-pro-mcp] MCP endpoint: http://${HTTP_HOST}:${PORT}/mcp`);
  if (oauthResourceServer) {
    console.error(`[premiere-pro-mcp] Auth: OAuth bearer tokens required`);
  } else if (httpAuth.authToken) {
    console.error(`[premiere-pro-mcp] Auth: Bearer token required`);
  } else {
    console.error(`[premiere-pro-mcp] Auth: disabled outside production for an explicit local/test override`);
  }
});

async function shutdown(signal: string) {
  console.error(`[premiere-pro-mcp] ${signal} received, shutting down...`);
  httpServer.close();
  await mcpHandler.close();
  await projectContextRepository.close();
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
