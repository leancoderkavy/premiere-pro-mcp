import { afterEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectHostRecovery } from "../src/bridge/host-lease.js";
import { createServer } from "../src/server.js";
import { cleanupTempDirs, makePrivateBridgeTempDir } from "./helpers/temp-dir.js";
import { refusalHost, type RefusalHostOptions } from "./helpers/refusal-host.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  cleanupTempDirs();
});

async function connected(options: RefusalHostOptions = {}) {
  const tempDir = makePrivateBridgeTempDir("premiere-definite-refusals-");
  const host = refusalHost(options);
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
  const client = new Client({ name: "definite-refusals-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  cleanups.push(async () => {
    await client.close(); await server.close(); clearInterval(poll);
    expect(panelErrors).toEqual([]);
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, tempDir, host };
}

describe("definite refusals through the server recovery boundary", () => {
  for (const name of ["undo", "multiple_undo", "redo"] as const) {
    it(name + " stale guard permits the following edit without acknowledgement", async () => {
      const { client, tempDir, host } = await connected();
      const refusal = await client.callTool({ name, arguments: { count: 1, expected_undo_stack_index: 0 } });
      expect(refusal).toMatchObject({ isError: true, structuredContent: { receipt: { outcome: "not_applied" } } });
      expect(host.undoCalls + host.redoCalls).toBe(0);
      expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
      const following = await client.callTool({ name: "rename_project_item", arguments: { item_id: "item-1", new_name: 'Renamed "quoted" é' } });
      expect(following.isError).toBeFalsy();
      expect(host.item.name).toBe('Renamed "quoted" é');
      expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
    }, 60000);
  }

  it("missing project directory permits the following edit without acknowledgement", async () => {
    const { client, tempDir, host } = await connected({ folderExists: false });
    const refusal = await client.callTool({ name: "create_project", arguments: { path: "/fixture/missing/new.prproj" } });
    expect(refusal).toMatchObject({ isError: true, structuredContent: { receipt: { outcome: "not_applied" } } });
    expect(host.newProjectCalls).toBe(0);
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
    const following = await client.callTool({ name: "rename_project_item", arguments: { item_id: "item-1", new_name: "Following edit" } });
    expect(following.isError).toBeFalsy();
    expect(host.item.name).toBe("Following edit");
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(false);
  }, 60000);

  it("keeps the recovery lock when project creation changes the host and then throws", async () => {
    const { client, tempDir, host } = await connected({ newProject: "change_then_throw" });
    const result = await client.callTool({ name: "create_project", arguments: { path: "/fixture/new.prproj" } });
    expect(result).toMatchObject({ isError: true, structuredContent: { receipt: { outcome: "unknown" } } });
    expect(host.app.project.path).toBe("/fixture/new.prproj");
    expect(host.newProjectCalls).toBe(1);
    expect(inspectHostRecovery(tempDir).recoveryRequired).toBe(true);
    const blocked = await client.callTool({ name: "rename_project_item", arguments: { item_id: "item-1", new_name: "Blocked" } });
    expect(blocked).toMatchObject({ isError: true, structuredContent: { error: expect.stringContaining("HOST_RECOVERY_REQUIRED") } });
    expect(host.item.name).toBe("Original");
  }, 60000);
});
