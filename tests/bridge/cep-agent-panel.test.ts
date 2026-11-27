import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, "cep-plugin", file), "utf8");

type Host = {
  postMessage: (msg: unknown) => void;
  addEventListener: (type: string, fn: (e: { data: any }) => void) => void;
};

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function loadHost(headless: boolean) {
  const data = mkdtempSync(join(tmpdir(), "agent-host-"));
  dirs.push(data);
  const fakeProcess = { env: { LOCALAPPDATA: data, APPDATA: data, PATH: "" } };
  const window: Record<string, unknown> = {};
  runInNewContext(read("agent-host.cjs"), {
    window,
    IS_HEADLESS_ENGINE: headless,
    nodeRequire: (name: string) => (name === "process" ? fakeProcess : require(name)),
    setTimeout,
    Promise,
    JSON,
    console,
  });
  return window.MCPAgentHost as Host | undefined;
}

describe("CEP in-panel agent", () => {
  it("loads the agent host and chat UI after the bridge", () => {
    const html = read("index.html");
    const order = ["main.js", "agent-host.cjs", "chat-ui.js"].map((src) => html.indexOf(`src="${src}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps the bridge elements main.js drives", () => {
    const html = read("index.html");
    for (const id of ["statusDot", "statusText", "statusDetail", "cmdCount", "tempDir", "btnStart", "btnStop", "log", "updateTitle", "btnUpdate"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("gives the signed-in CLIs only the Premiere MCP tools", () => {
    const host = read("agent-host.cjs");
    expect(host).toContain('"--allowedTools", "mcp__premiere"');
    expect(host).toContain('"--tools", ""');
    expect(host).toContain('"--strict-mcp-config"');
    expect(host).toContain('"--setting-sources", ""');
    expect(host).toContain('"--sandbox", "read-only"');
    expect(host).toContain('"--tools", "search_tool,use_tool"');
    expect(host).toContain("PREMIERE_TEMP_DIR");
    expect(host).toContain("PREMIERE_MCP_TITLE_DIR");
    expect(host).toContain("PREMIERE_CONTEXT_DIR");
    expect(host).not.toContain("unsafe-script");
  });

  it("does not run in the headless engine", () => {
    expect(loadHost(true)).toBeUndefined();
  });

  it("answers the page protocol from the visible panel", async () => {
    const host = loadHost(false)!;
    expect(host).toBeDefined();
    const messages: any[] = [];
    host.addEventListener("message", (e) => messages.push(e.data));
    host.postMessage({ type: "history" });
    host.postMessage({ type: "openChat", id: "not-an-id" });
    await new Promise((r) => setTimeout(r, 20));
    expect(messages.find((m) => m.type === "history")).toMatchObject({ items: [], canUndo: false });
    expect(messages.some((m) => m.type === "navigationRejected")).toBe(true);
  });

  it("folds narration between steps into one step group", () => {
    const ui = read("chat-ui.js");
    expect(ui).toContain("function foldNarration()");
    expect(ui).toContain('class="wl-update"');
  });
});
