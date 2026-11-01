import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

function source(file: string) {
  return process.env.BRIDGE_PERMISSION_BASELINE === "1"
    ? execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" })
    : readFileSync(file, "utf8");
}
function functions(file: string, names: string[]) {
  const text = source(file), parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const name of names) if (!found.has(name)) throw new Error(`Missing panel function ${name}`);
  return [...found.values()].join("\n");
}
function harness(plugin: "cep-plugin" | "after-effects-cep-plugin") {
  const files = new Map<string, { text: string; mode: number }>();
  const fs = {
    writeFileSync: vi.fn((path: string, text: string, options: any) => {
      if (options?.flag === "wx" && files.has(path)) throw Object.assign(new Error("collision"), { code: "EEXIST" });
      const mode = files.get(path)?.mode ?? (typeof options === "object" ? options.mode ?? 0o644 : 0o644);
      files.set(path, { text, mode });
    }),
    renameSync: vi.fn((from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); }),
    existsSync: vi.fn((path: string) => files.has(path)),
    unlinkSync: vi.fn((path: string) => files.delete(path)),
    readFileSync: vi.fn(() => "script"),
  };
  const callbacks: Array<() => void> = [];
  const context: Record<string, any> = {
    fs, path: { join: (...parts: string[]) => parts.join("/") }, tempDir: "/private/bridge",
    ENGINE_ID: "engine", engineId: "engine", bridgeRunning: true, running: true,
    IS_HEADLESS_ENGINE: false, HEADLESS_ENGINE_FILE: "headless-engine.json",
    log() {}, setStatus() {}, commandInFlight: false,
    setInterval: (callback: () => void) => { callbacks.push(callback); return 1; },
    clearInterval() {}, cs: { evalScript: vi.fn() },
  };
  const names = plugin === "cep-plugin" ? ["writeFile", "writeResponseFile", "deleteFile", "writeBridgeHeartbeat"] : ["writeFileAtomic", "heartbeat", "processOne", "replyFor"];
  runInNewContext(functions(`${plugin}/main.js`, names), context);
  return { fs, files, context, callbacks, publish: plugin === "cep-plugin" ? context.writeResponseFile : context.writeFileAtomic, heartbeat: plugin === "cep-plugin" ? context.writeBridgeHeartbeat : context.heartbeat };
}

describe.each(["cep-plugin", "after-effects-cep-plugin"] as const)("%s private result files", plugin => {
  it("creates response stages exclusively with mode 0600, then publishes complete bytes", () => {
    const test = harness(plugin);
    expect(test.publish("/private/bridge/res-test.json", "secret-result")).toBe(true);
    expect(test.fs.writeFileSync.mock.calls[0][2]).toMatchObject({ mode: 0o600, flag: "wx" });
    expect(test.files.get("/private/bridge/res-test.json")).toEqual({ text: "secret-result", mode: 0o600 });
    expect(test.fs.renameSync).toHaveBeenCalledOnce();
  });
  it("preserves an unrelated colliding stage and existing destination", () => {
    const test = harness(plugin);
    test.publish("/private/bridge/res-test.json", "initial");
    const staged = test.fs.writeFileSync.mock.calls[0][0];
    test.files.set(staged, { text: "unrelated-stage", mode: 0o640 });
    test.files.set("/private/bridge/res-test.json", { text: "unrelated-destination", mode: 0o640 });
    test.fs.renameSync.mockClear();
    expect(test.publish("/private/bridge/res-test.json", "overwrite")).toBe(false);
    expect(test.files.get(staged)?.text).toBe("unrelated-stage");
    expect(test.files.get("/private/bridge/res-test.json")?.text).toBe("unrelated-destination");
    expect(test.fs.renameSync).not.toHaveBeenCalled();
    expect(test.fs.unlinkSync).not.toHaveBeenCalled();
  });
  it("removes only a stage it created when publication fails", () => {
    const test = harness(plugin);
    test.fs.renameSync.mockImplementation(() => { throw new Error("rename refused"); });
    expect(test.publish("/private/bridge/res-test.json", "secret")).toBe(false);
    const staged = test.fs.writeFileSync.mock.calls[0][0];
    expect(test.fs.unlinkSync).toHaveBeenCalledExactlyOnceWith(staged);
    expect(test.files.size).toBe(0);
  });
  it("publishes heartbeat files with private creation permissions", () => {
    const test = harness(plugin);
    test.heartbeat();
    expect(test.files.get("/private/bridge/bridge-heartbeat.json")?.mode).toBe(0o600);
    expect(test.fs.writeFileSync.mock.calls[0][2]).toMatchObject({ mode: 0o600, flag: "wx" });
  });
});

it("publishes the headless engine marker through a private stage", () => {
  const test = harness("cep-plugin");
  test.context.IS_HEADLESS_ENGINE = true;
  test.heartbeat();
  expect(test.fs.writeFileSync.mock.calls).toHaveLength(2);
  expect(test.fs.writeFileSync.mock.calls.every(call => call[2]?.mode === 0o600 && call[2]?.flag === "wx")).toBe(true);
  expect(test.files.get("/private/bridge/headless-engine.json")).toEqual({ text: JSON.stringify({ engine: "engine" }), mode: 0o600 });
});
it("leaves an unrelated headless engine stage in place when its exclusive create collides", () => {
  const test = harness("cep-plugin");
  test.context.IS_HEADLESS_ENGINE = true;
  const staged = "/private/bridge/headless-engine.json.engine.staged";
  test.files.set(staged, { text: "unrelated-stage", mode: 0o640 });
  test.heartbeat();
  expect(test.files.get(staged)?.text).toBe("unrelated-stage");
  expect(test.files.has("/private/bridge/headless-engine.json")).toBe(false);
  expect(test.fs.unlinkSync).not.toHaveBeenCalled();
});
it("publishes repeated Premiere busy markers through fresh private stages", () => {
  const test = harness("cep-plugin");
  expect(test.context.writeFile("/private/bridge/busy-test.json", "first")).toBe(true);
  expect(test.context.writeFile("/private/bridge/busy-test.json", "second")).toBe(true);
  expect(test.fs.writeFileSync.mock.calls.every(call => call[2]?.mode === 0o600 && call[2]?.flag === "wx")).toBe(true);
  expect(test.files.get("/private/bridge/busy-test.json")).toEqual({ text: "second", mode: 0o600 });
});
it("publishes After Effects busy markers through fresh private stages", () => {
  const test = harness("after-effects-cep-plugin");
  test.files.set("/private/bridge/cmd_test.jsx", { text: "script", mode: 0o600 });
  test.context.processOne("cmd_test.jsx");
  expect(test.callbacks).toHaveLength(1);
  test.callbacks[0]();
  test.callbacks[0]();
  const writes = test.fs.writeFileSync.mock.calls;
  expect(writes).toHaveLength(2);
  expect(writes.every(call => call[2]?.mode === 0o600 && call[2]?.flag === "wx")).toBe(true);
  expect(test.files.get("/private/bridge/busy_test.json")?.mode).toBe(0o600);
});
