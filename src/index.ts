#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const debugEnabled = /^(1|true|yes|on|debug)$/i.test(
  process.env.PREMIERE_MCP_DEBUG ?? "",
);

function debugLog(message: string): void {
  if (debugEnabled) {
    console.error(`[premiere-pro-mcp] ${message}`);
  }
}

// Handle CLI flags
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
premiere-pro-mcp — MCP server for Adobe Premiere Pro (271 tools)

Usage:
  premiere-pro-mcp              Start the MCP server (stdio transport)
  premiere-pro-mcp --install-cep   Install the CEP plugin into Premiere Pro
  premiere-pro-mcp --diagnose-cep  Check the CEP install, debug keys, and Premiere signature logs
  premiere-pro-mcp --help          Show this help message
  premiere-pro-mcp --version       Show version

Environment variables:
  PREMIERE_TEMP_DIR     Shared temp directory (default: OS temp + /premiere-mcp-bridge)
  PREMIERE_TIMEOUT_MS   Command timeout in ms (default: 30000)
  PREMIERE_MCP_CAPABILITIES  Comma-separated authority profile
  PREMIERE_MCP_DEBUG    Set to 1/true to enable verbose stderr diagnostics

More info: https://github.com/leancoderkavy/premiere-pro-mcp
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = await import("../package.json", { with: { type: "json" } }).catch(
    () => ({ default: { version: "unknown" } }),
  );
  console.log(pkg.default.version);
  process.exit(0);
}

if (args.includes("--install-cep") || args.includes("--diagnose-cep")) {
  const diagnose = args.includes("--diagnose-cep");
  console.log(diagnose ? "Diagnosing CEP plugin...\n" : "Installing CEP plugin...\n");
  const isWindows = process.platform === "win32";
  const isMacOS = process.platform === "darwin";
  if (!isWindows && !isMacOS) {
    console.error(
      `CEP installation is supported only on Windows and macOS (current platform: ${process.platform}).`,
    );
    process.exit(1);
  }
  const scriptPath = path.join(
    projectRoot,
    "scripts",
    isWindows ? "install-cep.ps1" : "install-cep.sh",
  );
  try {
    if (isWindows) {
      const powershellArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
      if (diagnose) powershellArgs.push("-Diagnose");
      execFileSync(
        "powershell.exe",
        powershellArgs,
        { stdio: "inherit", cwd: projectRoot },
      );
    } else {
      execFileSync("bash", [scriptPath, diagnose ? "--diagnose" : "--copy"], {
        stdio: "inherit",
        cwd: projectRoot,
      });
    }
  } catch {
    console.error(`CEP ${diagnose ? "diagnostics" : "installation"} failed. Try running manually:`);
    console.error(
      isWindows
        ? `  powershell -ExecutionPolicy Bypass -File "${scriptPath}"${diagnose ? " -Diagnose" : ""}`
        : `  bash "${scriptPath}" ${diagnose ? "--diagnose" : "--copy"}`,
    );
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
  debugLog("Starting MCP server...");
  debugLog(`Temp directory: ${tempDir}`);

  // Clean up any stale files from previous sessions
  cleanupTempDir(bridgeOptions);

  const server = createServer(bridgeOptions);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  debugLog("Server connected and ready");
}

main().catch((err) => {
  console.error("[premiere-pro-mcp] Fatal error:", err);
  process.exit(1);
});
