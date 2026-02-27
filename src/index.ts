#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Handle CLI flags
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
premiere-pro-mcp — MCP server for Adobe Premiere Pro (269 tools)

Usage:
  premiere-pro-mcp              Start the MCP server (stdio transport)
  premiere-pro-mcp --install-cep   Install the CEP plugin into Premiere Pro
  premiere-pro-mcp --help          Show this help message
  premiere-pro-mcp --version       Show version

Environment variables:
  PREMIERE_TEMP_DIR     Shared temp directory (default: OS temp + /premiere-mcp-bridge)
  PREMIERE_TIMEOUT_MS   Command timeout in ms (default: 30000)

More info: https://github.com/ppmcp/premiere-pro-mcp
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = await import("../package.json", { with: { type: "json" } }).catch(
    () => ({ default: { version: "unknown" } })
  );
  console.log(pkg.default.version);
  process.exit(0);
}

if (args.includes("--install-cep")) {
  const scriptPath = path.join(projectRoot, "scripts", "install-cep.sh");
  console.log("Installing CEP plugin...\n");
  try {
    execSync(`bash "${scriptPath}"`, { stdio: "inherit", cwd: projectRoot });
  } catch {
    console.error("CEP installation failed. Try running manually:");
    console.error(`  bash "${scriptPath}"`);
    process.exit(1);
  }
  process.exit(0);
}

async function main() {
  const bridgeOptions = {
    tempDir: process.env.PREMIERE_TEMP_DIR,
    timeoutMs: process.env.PREMIERE_TIMEOUT_MS
      ? parseInt(process.env.PREMIERE_TIMEOUT_MS, 10)
      : undefined,
  };

  const tempDir = getTempDir(bridgeOptions);
  console.error(`[premiere-pro-mcp] Starting MCP server...`);
  console.error(`[premiere-pro-mcp] Temp directory: ${tempDir}`);

  // Clean up any stale files from previous sessions
  cleanupTempDir(bridgeOptions);

  const server = createServer(bridgeOptions);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`[premiere-pro-mcp] Server connected and ready`);
}

main().catch((err) => {
  console.error("[premiere-pro-mcp] Fatal error:", err);
  process.exit(1);
});
