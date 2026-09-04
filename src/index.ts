#!/usr/bin/env node

import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { cleanupTempDir, getTempDir } from "./bridge/file-bridge.js";
import { getTelemetry } from "./telemetry.js";
import { execFileSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { UxpWebSocketBridge } from "./bridge/uxp-websocket-bridge.js";
import {
  collectLocalDoctor,
  createSupportBundle,
  renderDoctorHuman,
} from "./diagnostics.js";
import { compareVersions, fetchLatestNpmVersion } from "./update.js";

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

type McpProtocolMode = "auto" | "legacy";

function readMcpProtocolMode(value = process.env.PREMIERE_MCP_PROTOCOL_MODE): McpProtocolMode {
  if (value === undefined || value === "" || value === "auto") return "auto";
  if (value === "legacy") return "legacy";
  throw new Error("PREMIERE_MCP_PROTOCOL_MODE must be either auto or legacy.");
}

function isLoopbackPortInUse(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && (error as NodeJS.ErrnoException).code === "EADDRINUSE",
  );
}

function npmInvocation(): { command: string; prefix: string[] } {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

  if (candidates.length > 0) return { command: process.execPath, prefix: [candidates[0]] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };
}

function globalNpmRoot(): string | undefined {
  const npm = npmInvocation();
  const result = spawnSync(npm.command, [...npm.prefix, "root", "--global"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout) return undefined;
  return path.resolve(result.stdout.trim());
}

function isGlobalNpmInstallation(globalRoot: string | undefined): boolean {
  if (!globalRoot) return false;
  const relative = path.relative(globalRoot, projectRoot);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function checkForPackageUpdate(): Promise<{ currentVersion: string; latestVersion: string; updateAvailable: boolean }> {
  const pkg = await import("../package.json", { with: { type: "json" } });
  const currentVersion = String(pkg.default.version ?? "unknown");
  const latestVersion = await fetchLatestNpmVersion(String(pkg.default.name ?? "premiere-pro-mcp"));
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
  };
}

async function runPackageUpdate(apply: boolean): Promise<void> {
  let update;
  try {
    update = await checkForPackageUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Could not check npm for an update: ${message}`);
    process.exit(1);
  }

  if (!update.updateAvailable) {
    console.log(`premiere-pro-mcp ${update.currentVersion} is current (npm latest: ${update.latestVersion}).`);
    if (apply) console.log("To repair the Premiere connector, fully quit Premiere and run premiere-pro-mcp --install-cep.");
    return;
  }

  if (!apply) {
    console.log(`Update available: ${update.currentVersion} → ${update.latestVersion}. Run premiere-pro-mcp --update after fully quitting Premiere.`);
    return;
  }

  if (!isGlobalNpmInstallation(globalNpmRoot())) {
    console.error("This server is not an npm global installation, so it will not be replaced automatically.");
    console.error("For a source checkout, fully quit Premiere and run: npm run update:source");
    process.exit(1);
  }

  const npm = npmInvocation();
  console.log(`Updating premiere-pro-mcp ${update.currentVersion} → ${update.latestVersion} and refreshing the Premiere connector...`);
  try {
    execFileSync(npm.command, [...npm.prefix, "install", "--global", "premiere-pro-mcp@latest"], {
      stdio: "inherit",
      windowsHide: true,
    });
    execFileSync(process.execPath, [__filename, "--install-cep"], {
      stdio: "inherit",
      cwd: projectRoot,
      windowsHide: true,
    });
  } catch {
    console.error("The package or connector update did not finish. Premiere must be fully closed before refreshing the connector.");
    process.exit(1);
  }
  console.log("Update complete. Restart Premiere and your MCP client, then run verify_premiere_connection before editing.");
}

// Handle CLI flags
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
premiere-pro-mcp — MCP server for Adobe Premiere Pro (330 default-profile tools)

Usage:
  premiere-pro-mcp              Start the MCP server (stdio transport)
  premiere-pro-mcp --install-cep   Install the CEP plugin into Premiere Pro
  premiere-pro-mcp --uninstall-cep Remove this CEP plugin from Premiere Pro
  premiere-pro-mcp --diagnose-cep  Check the CEP install, debug keys, and Premiere signature logs
  premiere-pro-mcp --install-after-effects-cep   Install the dedicated CEP plugin into After Effects
  premiere-pro-mcp --uninstall-after-effects-cep Remove this CEP plugin from After Effects
  premiere-pro-mcp --diagnose-after-effects-cep  Check the After Effects CEP install and debug keys
  premiere-pro-mcp --doctor        Check local install/configuration without reading a project
  premiere-pro-mcp --doctor --json Print the same local check as machine-readable JSON
  premiere-pro-mcp --support-bundle  Print a privacy-safe, machine-readable support bundle
  premiere-pro-mcp --check-update    Check npm for a newer released local server
  premiere-pro-mcp --update          Update an npm global install and refresh the CEP connector
  premiere-pro-mcp --help          Show this help message
  premiere-pro-mcp --version       Show version

Environment variables:
  PREMIERE_TEMP_DIR     Shared temp directory (default: OS temp + /premiere-mcp-bridge)
  PREMIERE_TIMEOUT_MS   Command timeout in ms (default: 30000)
  PREMIERE_MCP_CAPABILITIES  Comma-separated authority profile
  PREMIERE_MCP_TOOL_PACKS    Comma-separated discovery packs: full, essential, inspection, delivery, captions
  PREMIERE_MCP_DEBUG    Set to 1/true to enable verbose stderr diagnostics
  PREMIERE_MCP_PROTOCOL_MODE  auto (default) or legacy; use legacy only when a client cannot complete modern MCP negotiation
  PREMIERE_UXP_TOKEN    Enable the authenticated local UXP bridge (minimum 16 characters)
  PREMIERE_UXP_PORT     UXP loopback WebSocket port (default: 7777)
  AFTER_EFFECTS_MCP_TEMP_DIR  Shared AE bridge directory (default: OS temp + /after-effects-mcp-bridge)

More info: https://github.com/leancoderkavy/premiere-pro-mcp
`);
  process.exit(0);
}

const updateActions = ["--check-update", "--update"].filter((flag) => args.includes(flag));
if (updateActions.length > 1) {
  console.error("Use only one update action at a time: --check-update or --update.");
  process.exit(1);
}
if (updateActions.length === 1) {
  await runPackageUpdate(updateActions[0] === "--update");
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

const cepActions = [
  "--install-cep", "--uninstall-cep", "--diagnose-cep",
  "--install-after-effects-cep", "--uninstall-after-effects-cep", "--diagnose-after-effects-cep",
].filter((flag) => args.includes(flag));
if (cepActions.length > 1) {
  console.error("Use only one CEP action at a time.");
  process.exit(1);
}

if (cepActions.length === 1) {
  const action = cepActions[0];
  const diagnose = action === "--diagnose-cep" || action === "--diagnose-after-effects-cep";
  const afterEffects = action.includes("after-effects");
  const uninstall = action === "--uninstall-cep" || action === "--uninstall-after-effects-cep";
  const hostLabel = afterEffects ? "After Effects" : "Premiere Pro";
  console.log(uninstall
    ? `Removing ${hostLabel} CEP plugin...\n`
    : diagnose ? `Diagnosing ${hostLabel} CEP plugin...\n` : `Installing ${hostLabel} CEP plugin...\n`);
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
      if (afterEffects) powershellArgs.push("-ConnectorHost", "AfterEffects");
      execFileSync(
        "powershell.exe",
        powershellArgs,
        { stdio: "inherit", cwd: projectRoot },
      );
    } else {
      const macosScriptPath = uninstall
        ? path.join(projectRoot, "scripts", "uninstall-cep.sh")
        : scriptPath;
      const connectorArgs = [macosScriptPath, uninstall ? "--user" : diagnose ? "--diagnose" : "--copy"];
      if (afterEffects) connectorArgs.push("--after-effects");
      execFileSync("bash", connectorArgs, {
        stdio: "inherit",
        cwd: projectRoot,
      });
    }
  } catch {
    const operation = uninstall ? "uninstallation" : diagnose ? "diagnostics" : "installation";
    console.error(`${hostLabel} CEP ${operation} failed. Try running manually:`);
    console.error(
      isWindows
        ? `  powershell -ExecutionPolicy Bypass -File "${uninstall ? path.join(projectRoot, "scripts", "uninstall-cep.ps1") : scriptPath}"${diagnose ? " -Diagnose" : ""}${afterEffects ? " -ConnectorHost AfterEffects" : ""}`
        : `  bash "${uninstall ? path.join(projectRoot, "scripts", "uninstall-cep.sh") : scriptPath}" ${uninstall ? "--user" : diagnose ? "--diagnose" : "--copy"}${afterEffects ? " --after-effects" : ""}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

async function main() {
  process.env.PREMIERE_MCP_TRANSPORT = "stdio";
  const protocolMode = readMcpProtocolMode();
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
    const bridge = new UxpWebSocketBridge({
      token: process.env.PREMIERE_UXP_TOKEN,
      port: process.env.PREMIERE_UXP_PORT
        ? parseInt(process.env.PREMIERE_UXP_PORT, 10)
        : undefined,
    });
    try {
      await bridge.start();
      uxpBridge = bridge;
      const address = bridge.address();
      debugLog(`UXP bridge listening on ws://${address.host}:${address.port}${address.path}`);
    } catch (error) {
      if (!isLoopbackPortInUse(error)) throw error;
      console.error(
        "[premiere-pro-mcp] UXP bridge unavailable because its loopback port is already in use; continuing with CEP-only tools.",
      );
    }
  }

  const serverHandle = protocolMode === "legacy"
    ? await (async () => {
      const server = createServer(bridgeOptions, { uxpBridge, telemetry });
      const transport = new StdioServerTransport();
      await server.connect(transport);
      debugLog("Server connected in legacy MCP mode");
      return {
        close: async () => {
          await server.close();
          await transport.close();
        },
      };
    })()
    : serveStdio(
      () => createServer(bridgeOptions, { uxpBridge, telemetry }),
      {
        onerror: (error) => console.error("[premiere-pro-mcp] MCP stdio error:", error),
      },
    );
  if (protocolMode === "auto") debugLog("Server connected and ready");

  const shutdown = async () => {
    if (uxpBridge) await uxpBridge.stop();
    await serverHandle.close();
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((err) => {
  console.error("[premiere-pro-mcp] Fatal error:", err);
  process.exit(1);
});
