#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { getTelemetry } from "./telemetry.js";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { UxpWebSocketBridge } from "./bridge/uxp-websocket-bridge.js";
import {
  collectLocalDoctor,
  createSupportBundle,
  renderDoctorHuman,
} from "./diagnostics.js";

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
premiere-pro-mcp — MCP server for Adobe Premiere Pro (311 default-profile tools)

Usage:
  premiere-pro-mcp              Start the MCP server (stdio transport)
  premiere-pro-mcp --install-cep   Install the CEP plugin into Premiere Pro
  premiere-pro-mcp --uninstall-cep Remove this CEP plugin from Premiere Pro
  premiere-pro-mcp --diagnose-cep  Check the CEP install, debug keys, and Premiere signature logs
  premiere-pro-mcp --doctor        Check local install/configuration without reading a project
  premiere-pro-mcp --doctor --json Print the same local check as machine-readable JSON
  premiere-pro-mcp --support-bundle  Print a privacy-safe, machine-readable support bundle
  premiere-pro-mcp --help          Show this help message
  premiere-pro-mcp --version       Show version

Environment variables:
  PREMIERE_TEMP_DIR     Shared temp directory (default: OS temp + /premiere-mcp-bridge)
  PREMIERE_TIMEOUT_MS   Command timeout in ms (default: 30000)
  PREMIERE_MCP_CAPABILITIES  Comma-separated authority profile
  PREMIERE_MCP_DEBUG    Set to 1/true to enable verbose stderr diagnostics
  PREMIERE_UXP_TOKEN    Enable the authenticated local UXP bridge (minimum 16 characters)
  PREMIERE_UXP_PORT     UXP loopback WebSocket port (default: 7777)

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

if (args.includes("--doctor") || args.includes("--support-bundle")) {
  const pkg = await import("../package.json", { with: { type: "json" } }).catch(
    () => ({ default: { version: "unknown" } }),
  );
  if (args.includes("--support-bundle")) {
    // A support bundle is JSON by default so it can be attached to an issue or
    // support request without copying terminal output. It is a status snapshot,
    // never a project/log/configuration dump.
    console.log(JSON.stringify(createSupportBundle({ version: pkg.default.version }), null, 2));
  } else {
    const report = collectLocalDoctor();
    console.log(args.includes("--json")
      ? JSON.stringify(report, null, 2)
      : renderDoctorHuman(report));
  }
  process.exit(0);
}

const cepActions = ["--install-cep", "--uninstall-cep", "--diagnose-cep"].filter((flag) => args.includes(flag));
if (cepActions.length > 1) {
  console.error("Use only one CEP action at a time: --install-cep, --uninstall-cep, or --diagnose-cep.");
  process.exit(1);
}

if (cepActions.length === 1) {
  const action = cepActions[0];
  const diagnose = action === "--diagnose-cep";
  const uninstall = action === "--uninstall-cep";
  console.log(uninstall
    ? "Removing CEP plugin...\n"
    : diagnose ? "Diagnosing CEP plugin...\n" : "Installing CEP plugin...\n");
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
      if (uninstall) {
        powershellArgs[4] = path.join(projectRoot, "scripts", "uninstall-cep.ps1");
      }
      execFileSync(
        "powershell.exe",
        powershellArgs,
        { stdio: "inherit", cwd: projectRoot },
      );
    } else {
      const macosScriptPath = uninstall
        ? path.join(projectRoot, "scripts", "uninstall-cep.sh")
        : scriptPath;
      execFileSync("bash", [macosScriptPath, uninstall ? "--user" : diagnose ? "--diagnose" : "--copy"], {
        stdio: "inherit",
        cwd: projectRoot,
      });
    }
  } catch {
    const operation = uninstall ? "uninstallation" : diagnose ? "diagnostics" : "installation";
    console.error(`CEP ${operation} failed. Try running manually:`);
    console.error(
      isWindows
        ? `  powershell -ExecutionPolicy Bypass -File "${uninstall ? path.join(projectRoot, "scripts", "uninstall-cep.ps1") : scriptPath}"${diagnose ? " -Diagnose" : ""}`
        : `  bash "${uninstall ? path.join(projectRoot, "scripts", "uninstall-cep.sh") : scriptPath}" ${uninstall ? "--user" : diagnose ? "--diagnose" : "--copy"}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

async function main() {
  process.env.PREMIERE_MCP_TRANSPORT = "stdio";
  const telemetry = getTelemetry();
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

  let uxpBridge: UxpWebSocketBridge | undefined;
  if (process.env.PREMIERE_UXP_TOKEN) {
    uxpBridge = new UxpWebSocketBridge({
      token: process.env.PREMIERE_UXP_TOKEN,
      port: process.env.PREMIERE_UXP_PORT
        ? parseInt(process.env.PREMIERE_UXP_PORT, 10)
        : undefined,
    });
    await uxpBridge.start();
    const address = uxpBridge.address();
    debugLog(`UXP bridge listening on ws://${address.host}:${address.port}${address.path}`);
  }

  const server = createServer(bridgeOptions, { uxpBridge, telemetry });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  debugLog("Server connected and ready");

  const shutdown = async () => {
    if (uxpBridge) await uxpBridge.stop();
    await server.close();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((err) => {
  console.error("[premiere-pro-mcp] Fatal error:", err);
  process.exit(1);
});
