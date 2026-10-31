import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../../src/server.js";
import { recentOperations, resetOperationLog } from "../../src/workflows/operation-log.js";
import {
  IDEMPOTENCY_KEY_LIMIT,
  IDEMPOTENCY_RESULT_BYTES_LIMIT,
  IDEMPOTENCY_TTL_MS,
  canonicalJson,
  claimIdempotencyKey,
  completeIdempotencyKey,
  idempotencyKeyHashPrefix,
  idempotencyStoreStats,
  resetIdempotencyStore,
} from "../../src/workflows/idempotency.js";
import { toolMayChangeState } from "../../src/security/capabilities.js";

const fixture = vi.hoisted(() => ({
  calls: [] as string[],
  release: undefined as (() => void) | undefined,
}));

vi.mock("../../src/tools/discovery.js", () => {
  const local = { backend: "local", backends: ["local"] };
  const modes = ["ok", "wait", "not_applied", "unknown", "big"];
  return { getDiscoveryTools: () => ({
    set_idempotency_fixture: {
      description: "Local mutating fixture for idempotency tests.",
      operationalCapability: local,
      parameters: { type: "object", additionalProperties: false, properties: {
        mode: { type: "string", enum: modes, description: "Fixture behavior." },
        value: { type: "integer", description: "Argument that changes the hash." },
      }, required: ["mode"] },
      handler: async (args: { mode: string; value?: number }) => {
        fixture.calls.push(args.mode);
        if (args.mode === "wait") await new Promise<void>((resolve) => { fixture.release = resolve; });
        if (args.mode === "not_applied") return { success: false, error: "fixture preflight refusal", data: { outcome: "not_applied" } };
        if (args.mode === "unknown") return { success: false, error: "fixture readback unavailable", data: { outcome: "unknown" } };
        if (args.mode === "big") return { success: true, data: { outcome: "verified", blob: "x".repeat(IDEMPOTENCY_RESULT_BYTES_LIMIT) } };
        return { success: true, data: { outcome: "verified", call: fixture.calls.length } };
      },
    },
    get_idempotency_fixture: {
      description: "Local read-only fixture.",
      operationalCapability: local,
      parameters: { type: "object", additionalProperties: false, properties: {} },
      handler: async () => { fixture.calls.push("read"); return { success: true, data: { read: true } }; },
    },
    // Name shares the real action-capability map: inspect is read-only, add_effect edits.
    batch_selected_clips_uxp: {
      description: "Local multi-action fixture.",
      operationalCapability: local,
      parameters: { type: "object", additionalProperties: false, properties: {
        action: { type: "string", enum: ["inspect", "add_effect"], description: "Action." },
      }, required: ["action"] },
      handler: async (args: { action: string }) => { fixture.calls.push(args.action); return { success: true, data: { action: args.action } }; },
    },
  }) };
});

type Result = { structuredContent?: Record<string, unknown>; content: { type: string; text?: string }[]; isError?: boolean };
const cleanups: (() => Promise<void>)[] = [];

async function connected() {
  const server = createServer({}, { toolPacks: "full", telemetry: { enabled: false, capture() {}, async shutdown() {} } });
  const client = new Client({ name: "idempotency-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => { await client.close(); await server.close(); });
  return (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<Result>;
}

beforeEach(() => { resetIdempotencyStore(); resetOperationLog(); fixture.calls = []; fixture.release = undefined; });
afterEach(async () => { fixture.release?.(); for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("idempotency_key over MCP", () => {
  it("keeps keys separate between server instances (MCP sessions)", async () => {
    const first = await connected();
    const second = await connected();
    await first("set_idempotency_fixture", { mode: "ok", idempotency_key: "edit-1" });
    const other = await second("set_idempotency_fixture", { mode: "ok", idempotency_key: "edit-1" });
    expect(other.structuredContent).not.toHaveProperty("idempotency");
    expect(fixture.calls).toEqual(["ok", "ok"]);
  });

  it("runs the first call and replays a successful retry without running it again", async () => {
    const call = await connected();
    const first = await call("set_idempotency_fixture", { mode: "ok", idempotency_key: "edit-1" });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ ok: true, data: { call: 1 }, receipt: { outcome: "verified" } });
    expect(first.structuredContent).not.toHaveProperty("idempotency");

    // Argument order must not change the canonical hash.
    const retry = await call("set_idempotency_fixture", { idempotency_key: "edit-1", mode: "ok" });
    expect(fixture.calls).toEqual(["ok"]);
    expect(retry.structuredContent).toMatchObject({ ok: true, data: { call: 1 }, receipt: { outcome: "verified" }, idempotency: { replayed: true, sequence: 1, status: "succeeded", outcome: "verified" } });
    expect(retry.content.at(-1)?.text).toContain("not run again");

    // Only one operation was logged, tagged with a key hash and never the raw key.
    const operations = recentOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ tool: "set_idempotency_fixture", idempotencyKeyHash: idempotencyKeyHashPrefix("edit-1") });
    expect(JSON.stringify(operations)).not.toContain("edit-1");

    // The same key on a different tool is a separate scope.
    const other = await call("batch_selected_clips_uxp", { action: "add_effect", idempotency_key: "edit-1" });
    expect(other.structuredContent).toMatchObject({ ok: true, data: { action: "add_effect" } });
    expect(other.structuredContent).not.toHaveProperty("idempotency");
  });

  it("refuses a duplicate while the first call is still running", async () => {
    const call = await connected();
    const pending = call("set_idempotency_fixture", { mode: "wait", idempotency_key: "slow-1" });
    await vi.waitFor(() => expect(fixture.release).toBeDefined());
    const duplicate = await call("set_idempotency_fixture", { mode: "wait", idempotency_key: "slow-1" });
    expect(duplicate.isError).toBe(true);
    expect(duplicate.structuredContent).toMatchObject({ ok: false, data: { code: "IDEMPOTENCY_IN_PROGRESS", sequence: 1 }, idempotency: { replayed: false, status: "running" } });
    expect(duplicate.structuredContent?.error).toContain("get_last_operations");
    expect(fixture.calls).toEqual(["wait"]);
    expect(recentOperations()).toHaveLength(1);
    fixture.release!();
    await expect(pending).resolves.toMatchObject({ structuredContent: { ok: true } });
    const after = await call("set_idempotency_fixture", { mode: "wait", idempotency_key: "slow-1" });
    expect(after.structuredContent).toMatchObject({ ok: true, idempotency: { replayed: true, status: "succeeded" } });
    expect(fixture.calls).toEqual(["wait"]);
  });

  it("refuses a reused key with different arguments", async () => {
    const call = await connected();
    await call("set_idempotency_fixture", { mode: "ok", value: 1, idempotency_key: "k" });
    const reused = await call("set_idempotency_fixture", { mode: "ok", value: 2, idempotency_key: "k" });
    expect(reused.isError).toBe(true);
    expect(reused.structuredContent).toMatchObject({ ok: false, data: { code: "IDEMPOTENCY_KEY_REUSED", sequence: 1 } });
    expect(fixture.calls).toEqual(["ok"]);
  });

  it("replays a failure with an unknown outcome instead of retrying it", async () => {
    const call = await connected();
    const first = await call("set_idempotency_fixture", { mode: "unknown", idempotency_key: "u-1" });
    expect(first.structuredContent).toMatchObject({ ok: false, receipt: { outcome: "unknown" } });
    const retry = await call("set_idempotency_fixture", { mode: "unknown", idempotency_key: "u-1" });
    expect(retry.isError).toBe(true);
    expect(retry.structuredContent).toMatchObject({ ok: false, receipt: { outcome: "unknown" }, idempotency: { replayed: true, status: "failed", outcome: "unknown" } });
    expect(fixture.calls).toEqual(["unknown"]);
  });

  it("lets a definite not_applied failure run again under the same key", async () => {
    const call = await connected();
    const first = await call("set_idempotency_fixture", { mode: "not_applied", idempotency_key: "n-1" });
    expect(first.structuredContent).toMatchObject({ ok: false, receipt: { outcome: "not_applied" } });
    const retry = await call("set_idempotency_fixture", { mode: "not_applied", idempotency_key: "n-1" });
    expect(retry.structuredContent).not.toHaveProperty("idempotency");
    expect(fixture.calls).toEqual(["not_applied", "not_applied"]);
    expect(recentOperations()).toHaveLength(2);
  });

  it("replays an outcome without the oversized original result", async () => {
    const call = await connected();
    await call("set_idempotency_fixture", { mode: "big", idempotency_key: "b-1" });
    expect(idempotencyStoreStats()).toEqual({ keys: 1, retainedResponseBytes: 0 });
    const retry = await call("set_idempotency_fixture", { mode: "big", idempotency_key: "b-1" });
    expect(retry.structuredContent).toMatchObject({ ok: true, data: { replayed: true, originalResultRetained: false }, idempotency: { replayed: true, outcome: "verified" } });
    expect(fixture.calls).toEqual(["big"]);
  });

  it("advertises the key on every tool whose authority escalates with its arguments", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../src/security/capabilities.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("export function capabilitiesForToolInvocation"), source.indexOf("export function toolMayChangeState"));
    const special = [...new Set([...body.matchAll(/toolName === "([a-z0-9_]+)"/g)].map((match) => match[1]))];
    expect(special).toEqual(expect.arrayContaining(["audit_project_structure", "retime_caption_file"]));
    for (const name of special) expect(toolMayChangeState(name), name).toBe(true);
  });

  it("advertises the key only on tools that can change state and ignores it on read-only actions", async () => {
    const call = await connected();
    expect(toolMayChangeState("set_idempotency_fixture")).toBe(true);
    expect(toolMayChangeState("get_idempotency_fixture")).toBe(false);
    expect(toolMayChangeState("batch_selected_clips_uxp")).toBe(true);
    const rejected = await call("get_idempotency_fixture", { idempotency_key: "r-1" }).then((result) => result.content.map((entry) => entry.text).join(""), (error: Error) => error.message);
    expect(rejected).toContain("unknown argument idempotency_key");

    // A read-only action of a multi-action tool runs every time and is never logged.
    await call("batch_selected_clips_uxp", { action: "inspect", idempotency_key: "r-2" });
    const second = await call("batch_selected_clips_uxp", { action: "inspect", idempotency_key: "r-2" });
    expect(second.structuredContent).not.toHaveProperty("idempotency");
    expect(fixture.calls).toEqual(["inspect", "inspect"]);
    expect(idempotencyStoreStats().keys).toBe(0);
    expect(recentOperations()).toHaveLength(0);
  });

  it("rejects malformed keys by schema", async () => {
    const call = await connected();
    const outcome = await call("set_idempotency_fixture", { mode: "ok", idempotency_key: "has space" }).then((result) => result.content.map((entry) => entry.text).join(""), (error: Error) => error.message);
    expect(outcome).toMatch(/pattern/);
    expect(fixture.calls).toEqual([]);
  });
});

describe("idempotency store bounds", () => {
  it("canonicalizes argument key order", () => {
    expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: null, skip: undefined })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });

  it("evicts least recently used finished keys beyond the limit and keeps running ones", () => {
    let sequence = 0;
    const running = claimIdempotencyKey("set_x", "running", {}, () => ++sequence, 0);
    expect(running.kind).toBe("new");
    for (let index = 0; index < IDEMPOTENCY_KEY_LIMIT + 10; index++) {
      const claim = claimIdempotencyKey("set_x", `k${index}`, {}, () => ++sequence, index + 1);
      if (claim.kind !== "new") throw new Error("expected new claim");
      completeIdempotencyKey(claim.record, true, "verified", { structuredContent: { ok: true }, content: [] }, index + 1);
    }
    expect(idempotencyStoreStats().keys).toBe(IDEMPOTENCY_KEY_LIMIT);
    expect(claimIdempotencyKey("set_x", "running", {}, () => ++sequence, 1_000).kind).toBe("in_progress");
    // k0 was evicted, so it is claimed afresh; the newest key still replays.
    expect(claimIdempotencyKey("set_x", `k${IDEMPOTENCY_KEY_LIMIT + 9}`, {}, () => ++sequence, 1_001).kind).toBe("replay");
    expect(claimIdempotencyKey("set_x", "k0", {}, () => ++sequence, 1_002).kind).toBe("new");
  });

  it("expires finished keys after the TTL but never a running key", () => {
    let sequence = 0;
    const done = claimIdempotencyKey("set_x", "done", {}, () => ++sequence, 0);
    if (done.kind !== "new") throw new Error("expected new claim");
    completeIdempotencyKey(done.record, true, "verified", undefined, 0);
    claimIdempotencyKey("set_x", "slow", {}, () => ++sequence, 0);
    expect(claimIdempotencyKey("set_x", "done", {}, () => ++sequence, IDEMPOTENCY_TTL_MS).kind).toBe("replay");
    expect(claimIdempotencyKey("set_x", "done", {}, () => ++sequence, 2 * IDEMPOTENCY_TTL_MS + 1).kind).toBe("new");
    expect(claimIdempotencyKey("set_x", "slow", {}, () => ++sequence, 3 * IDEMPOTENCY_TTL_MS).kind).toBe("in_progress");
  });

  it("treats a call that ended without a receipt as unknown, not retryable", () => {
    const claim = claimIdempotencyKey("set_x", "lost", {}, () => 1, 0);
    if (claim.kind !== "new") throw new Error("expected new claim");
    completeIdempotencyKey(claim.record, false, null, undefined, 1);
    expect(claimIdempotencyKey("set_x", "lost", {}, () => 2, 2)).toMatchObject({ kind: "replay", outcome: "unknown" });
  });
});
