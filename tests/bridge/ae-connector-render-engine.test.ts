import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Live (AE 26.5, macOS): Premiere's Dynamic Link starts a windowless After
// Effects, aerendercore, under dynamiclinkmanager. It loads CEP extensions, so
// its connector claimed AE commands, answered for an empty project and hung on
// app.open. The connector must stay idle there.
const source = readFileSync(new URL("../../after-effects-cep-plugin/main.js", import.meta.url), "utf8");

function load({ ancestry, isRenderEngine = "false", psFails = false }: { ancestry: string[]; isRenderEngine?: string; psFails?: boolean }) {
  const elements: Record<string, { value: string; textContent: string; style: Record<string, string>; onclick?: () => void }> = {};
  const element = (id: string) => (elements[id] ??= { value: "", textContent: "", style: {} });
  const timers: Array<() => void> = [];
  const evalScripts: string[] = [];
  const pids = ancestry.map((_, i) => 100 + i);
  const childProcess = {
    execFileSync: (_command: string, args: string[]) => {
      if (psFails) throw new Error("ps unavailable");
      const index = pids.indexOf(Number(args[args.length - 1]));
      if (index < 0) throw new Error("no such process");
      const parent = index + 1 < pids.length ? pids[index + 1] : 1;
      return `  ${parent} ${ancestry[index]}\n`;
    },
  };
  const modules: Record<string, unknown> = {
    fs: { readdirSync: () => [], writeFileSync() {}, renameSync() {}, existsSync: () => false, unlinkSync() {} },
    path, os: { platform: () => "darwin", tmpdir: () => "/tmp" },
    process: { pid: pids[0], env: {} },
    child_process: childProcess,
  };
  class CSInterface { evalScript(script: string, callback: (result: string) => void) { evalScripts.push(script); callback(isRenderEngine); } }
  const context = {
    require: (name: string) => modules[name],
    document: { getElementById: element },
    localStorage: { getItem: () => null, setItem() {} },
    MCPBridgeDirectorySecurity: { createBridgeDirectorySecurity: () => ({ ensurePrivateBridgeDirectory: (dir: string) => dir }) },
    CSInterface, Buffer, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    setInterval: () => 1, clearInterval() {}, Date,
  };
  runInNewContext(source, context);
  return { status: () => element("status").textContent, timers, evalScripts };
}

const visible = ["CEPHtmlEngine Helper (Renderer)", "CEPHtmlEngine", "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app/Contents/MacOS/After Effects"];
const renderEngine = ["CEPHtmlEngine Helper (Renderer)", "CEPHtmlEngine", "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app/Contents/aerendercore.app/Contents/MacOS/aerendercore", "dynamiclinkmanager"];

describe("After Effects connector inside the Dynamic Link render engine", () => {
  it("stays idle when an ancestor process is aerendercore", () => {
    const panel = load({ ancestry: renderEngine });
    expect(panel.timers).toHaveLength(0);
    expect(panel.status()).toBe("Idle in the Dynamic Link render engine");
    expect(panel.evalScripts).toHaveLength(0);
  });

  it("stays idle when the host reports a render engine", () => {
    const panel = load({ ancestry: visible, isRenderEngine: "true" });
    expect(panel.timers).toHaveLength(0);
    expect(panel.status()).toBe("Idle in the Dynamic Link render engine");
  });

  it("starts in the visible After Effects", () => {
    const panel = load({ ancestry: visible });
    expect(panel.evalScripts).toHaveLength(1);
    expect(panel.timers).toHaveLength(1);
    panel.timers[0]();
    expect(panel.status()).toBe("Connector running");
  });

  it("falls back to the host check when process ancestry is unreadable", () => {
    expect(load({ ancestry: renderEngine, psFails: true, isRenderEngine: "true" }).timers).toHaveLength(0);
    expect(load({ ancestry: renderEngine, psFails: true, isRenderEngine: "false" }).timers).toHaveLength(1);
  });
});
