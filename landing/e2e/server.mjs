import http from "node:http";
import { cp, mkdtemp, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.LANDING_E2E_PORT || 3160);
const fixturePort = Number(process.env.LANDING_E2E_POSTHOG_PORT || 3161);
await stat(path.join(repository, "dist/http-server.js"));
await stat(path.join(repository, "landing/out/design-preview/index.html"));
await cp(path.join(repository, "landing/out"), path.join(repository, "landing-dist"), { recursive: true });
const bridgeDirectory = await mkdtemp(path.join(os.tmpdir(), "premiere-homepage-e2e-"));
let variant = "test";
let events = [];
let evaluations = [];

// A real HTTP fixture for the actual posthog-node client, never production data.
const fixture = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const raw = req.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes;
  const body = JSON.parse(raw.toString() || "{}");
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/__state") {
    if (req.method === "POST") {
      variant = body.variant ?? "test";
      events = [];
      evaluations = [];
    }
    res.end(JSON.stringify({ variant, events, evaluations }));
  } else if (req.url?.startsWith("/flags") || req.url?.startsWith("/decide")) {
    evaluations.push(body);
    if (variant === "unavailable") {
      res.writeHead(503);
      res.end("{}");
    } else {
      res.end(JSON.stringify({ featureFlags: { "homepage-cinematic-2026": variant }, featureFlagPayloads: {} }));
    }
  } else {
    events.push(...(body.batch ?? (body.event ? [body] : [])));
    res.end(JSON.stringify({ status: 1 }));
  }
});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(fixturePort, "127.0.0.1", resolve);
});

const server = spawn(process.execPath, ["dist/http-server.js"], {
  cwd: repository,
  windowsHide: true,
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_AUTH_TOKEN: "local-homepage-e2e-only",
    PREMIERE_TEMP_DIR: bridgeDirectory,
    PREMIERE_CONTEXT_BACKEND: "memory",
    PREMIERE_MCP_TOOL_PACKS: "full",
    MCP_OAUTH_ISSUER: "",
    POSTHOG_API_KEY: "phc_local_homepage_e2e_only",
    POSTHOG_HOST: `http://127.0.0.1:${fixturePort}`,
    POSTHOG_DISTINCT_ID: "local-homepage-e2e-server",
    POSTHOG_ENVIRONMENT: "local-e2e",
    HOMEPAGE_EXPERIMENT_ENABLED: "true",
    HOMEPAGE_EXPERIMENT_SECRET: "local-homepage-e2e-signing-secret-only-32",
  },
});
server.on("exit", (code) => { fixture.close(); process.exitCode = code ?? 0; });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { server.kill("SIGTERM"); fixture.close(); });
}
