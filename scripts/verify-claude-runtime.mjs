import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Package-process checks only: no Adobe application or bridge is contacted.
export async function verifyClaudeRuntime(stage, expectedVersion) {
  const entry = path.resolve(stage, "server", "dist", "index.js");
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "premiere-mcpb-smoke-"));
  const env = {
    ...process.env,
    PREMIERE_BRIDGE_MODE: "cep",
    PREMIERE_MCP_PROTOCOL_MODE: "auto",
    PREMIERE_MCP_TOOL_PACKS: "full",
    PREMIERE_MCP_CAPABILITIES: "inspect,edit,export,filesystem",
    POSTHOG_API_KEY: "",
    PREMIERE_TEMP_DIR: runtimeDir,
  };
  const client = new Client({ name: "mcpb-package-verifier", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: "pipe" });
  try {
    const reportedVersion = execFileSync(process.execPath, [entry, "--version"], {
      encoding: "utf8", timeout: 30_000, env,
    }).trim();
    if (reportedVersion !== expectedVersion) throw new Error(`MCPB CLI reports ${reportedVersion}; expected ${expectedVersion}`);
    await client.connect(transport, { timeout: 30_000 });
    if (client.getServerVersion()?.version !== expectedVersion) throw new Error("MCPB initialize reports a mismatched server version");
    const result = await client.listTools({}, { timeout: 30_000 });
    if (!result.tools.some((tool) => tool.name === "verify_premiere_connection")) throw new Error("MCPB tools/list is missing connection diagnostics");
    console.log(`Verified MCPB CLI, initialize and tools/list for ${expectedVersion}. Adobe host behavior was not tested.`);
  } finally {
    try {
      await client.close();
    } finally {
      try {
        await transport.close();
      } finally {
        await rm(runtimeDir, { recursive: true, force: true });
      }
    }
  }
}
