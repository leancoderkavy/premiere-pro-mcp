import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClientConfigAction, renderClientConfig } from "../src/client-config.js";

describe("configuration for an exact local installation", () => {
  it.each(["claude", "cursor"] as const)("prints a %s entry without relying on the global command", (client) => {
    const node = 'C:\\Program Files\\nodejs\\node.exe';
    const server = 'C:\\Users\\An Editor\\MCP \\"test"\\dist\\index.js';
    const config = JSON.parse(renderClientConfig(client, node, server, "win32"));
    expect(config).toEqual({ mcpServers: { "premiere-pro-leancoderkavy": { command: node, args: [server] } } });
  });

  it("uses VS Code's servers container and serializes macOS paths as arguments", () => {
    const config = JSON.parse(renderClientConfig("vscode", "/opt/node/bin/node", "/Users/Editor/MCP & tools/dist/index.js", "darwin"));
    expect(config).toEqual({ servers: { "premiere-pro-leancoderkavy": {
      type: "stdio", command: "/opt/node/bin/node", args: ["/Users/Editor/MCP & tools/dist/index.js"],
    } } });
  });

  it("escapes Codex TOML paths, including Windows backslashes and quotes", () => {
    const config = renderClientConfig("codex", "C:\\Program Files\\node.exe", 'C:\\MCP "copy"\\dist\\index.js', "win32");
    const lines = config.trim().split("\n");
    expect(lines[0]).toBe("[mcp_servers.premiere-pro-leancoderkavy]");
    expect(JSON.parse(lines[1].slice("command = ".length))).toBe("C:\\Program Files\\node.exe");
    expect(JSON.parse(lines[2].slice("args = ".length))).toEqual(['C:\\MCP "copy"\\dist\\index.js']);
  });

  it.each(["relative/index.js", "/tmp/new\nline/index.js", "/tmp/${input:command}/index.js"])("rejects a path clients could misinterpret: %s", (entry) => {
    expect(() => renderClientConfig("cursor", "/usr/bin/node", entry, "darwin")).toThrow("absolute paths");
  });

  it.each([
    ["--print-client-config"], ["--print-client-config", "unknown"],
    ["--print-client-config=codex"], ["--print-client-config", "codex", "--install-cep"],
    ["--update", "--print-client-config", "vscode"], ["--help", "--print-client-config", "claude"],
  ])("rejects incomplete or combined actions before any mutation: %j", (...args) => {
    expect(() => parseClientConfigAction(args)).toThrow("Use this action alone");
  });

  it("leaves existing CLI actions alone", () => {
    expect(parseClientConfigAction(["--doctor", "--json"])).toBeUndefined();
    expect(parseClientConfigAction(["--print-client-config", "codex"])).toBe("codex");
  });

  it("emits clean JSON from the built CLI that can launch the same package", () => {
    const cli = path.resolve("dist/index.js");
    const result = spawnSync(process.execPath, [cli, "--print-client-config", "claude"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const entry = JSON.parse(result.stdout).mcpServers["premiere-pro-leancoderkavy"];
    expect(entry).toEqual({ command: process.execPath, args: [cli] });
    const version = execFileSync(entry.command, [...entry.args, "--version"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    expect(version.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits on a conflicting installer flag without running an installer", () => {
    const result = spawnSync(process.execPath, [path.resolve("dist/index.js"), "--print-client-config", "claude", "--install-cep"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Use this action alone");
  });
});
