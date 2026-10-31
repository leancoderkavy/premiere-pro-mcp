import { afterEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectHostRecovery } from "../src/bridge/host-lease.js";
import { createServer } from "../src/server.js";
import { cleanupTempDirs, makePrivateBridgeTempDir } from "./helpers/temp-dir.js";
import { effectRemovalHost, type RemovalHostOptions } from "./helpers/effect-removal-host.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  cleanupTempDirs();
});

async function connected(options: RemovalHostOptions = {}) {
  const tempDir = makePrivateBridgeTempDir("premiere-builtin-refusals-");
  const host = effectRemovalHost(options);
  const replied = new Set<string>();
  const panelErrors: unknown[] = [];
  const respond = () => {
    for (const name of readdirSync(tempDir)) {
      if (!/^cmd_[a-f0-9-]+\.jsx$/.test(name) || replied.has(name)) continue;
      let script: string;
      try { script = readFileSync(join(tempDir, name), "utf8"); } catch { continue; }
      replied.add(name);
      let result: unknown;
      try { result = host.run(script); }
      catch (error) { panelErrors.push(error); result = { success: false, error: String(error) }; }
      writeFileSync(join(tempDir, name.replace(/^cmd_/, "res_").replace(/\.jsx$/, ".json")), JSON.stringify(result), { mode: 0o600 });
    }
  };
  const poll = setInterval(respond, 25);
  const server = createServer({ tempDir, timeoutMs: 1000 }, {
    toolPacks: "full", telemetry: { enabled: false, capture() {}, async shutdown() {} },
  });
  const client = new Client({ name: "builtin-refusals-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  cleanups.push(async () => {
    await client.close(); await server.close(); clearInterval(poll);
    expect(panelErrors).toEqual([]);
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, tempDir, host };
}

const safeCases: Array<{ tool: string; args: Record<string, unknown>; options?: RemovalHostOptions }> = [
  ...[["Volume", "Internal Volume Mono"], ["Panner", "Internal Audio Panner"], ["Motion", "AE.ADBE Motion"], ["Opacity", "AE.ADBE Opacity"]].map(([name, match]) => ({ tool: "remove_effect", args: { effect_name: name }, options: { names: [[name, match]] as Array<[string, string]> } })),
  { tool: "remove_effect", args: { effect_name: "Channel Volume" } },
  { tool: "remove_effect", args: { effect_index: 99 } },
  { tool: "remove_effect_by_name", args: { effect_name: "Deckkraft" }, options: { names: [["Deckkraft", "AE.ADBE Opacity"]] } },
  { tool: "remove_all_effects", args: {}, options: { names: [["Deckkraft", "AE.ADBE Opacity"], ["Tint", "AE.ADBE Tint"]] } },
  ...["remove_effect", "remove_effect_by_name", "remove_all_effects"].map(tool => ({ tool, args: tool === "remove_all_effects" ? {} : { effect_name: "Tint" }, options: { mode: "unsupported" as const } })),
];
describe("effect-removal refusals through the real recovery boundary", () => {
  it.each(safeCases)("$tool $args leaves recovery clear and permits the next edit", async ({ tool, args, options }) => {
    const { client, tempDir, host } = await connected(options);
    const response = await client.callTool({ name: tool, arguments: { node_id: host.clip.nodeId, ...args } });
    expect(response).toMatchObject({ isError: true, structuredContent: { receipt: { outcome: "not_applied" } } });
    expect(host.attempts).toBe(0); expect(host.qeAttempts).toBe(0);
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
    const following = await client.callTool({ name: "rename_project_item", arguments: { item_id: host.item.nodeId, new_name: 'Next "edit" é' } });
    expect(following.isError).toBeFalsy(); expect(host.item.name).toBe('Next "edit" é');
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
  }, 60000);
  it.each(["remove_effect", "remove_effect_by_name", "remove_all_effects"])("%s keeps recovery required when removal changes the stack and then throws", async tool => {
    const { client, tempDir, host } = await connected({ mode: "remove_then_throw" });
    const response = await client.callTool({ name: tool, arguments: { node_id: host.clip.nodeId, ...(tool === "remove_all_effects" ? {} : { effect_name: "Tint" }) } });
    expect(response).toMatchObject({ isError: true, structuredContent: { receipt: { outcome: "unknown" } } });
    expect(host.attempts).toBe(1); expect(host.qeAttempts).toBe(0);
    expect(host.list.map(component => component.displayName)).not.toContain("Tint");
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(true);
    const blocked = await client.callTool({ name: "rename_project_item", arguments: { item_id: host.item.nodeId, new_name: "Blocked" } });
    expect(blocked).toMatchObject({ isError: true, structuredContent: { error: expect.stringContaining("HOST_RECOVERY_REQUIRED") } });
    expect(host.item.name).toBe("Original");
  }, 60000);
});
