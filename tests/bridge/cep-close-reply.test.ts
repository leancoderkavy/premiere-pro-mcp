import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../../cep-plugin/main.js", import.meta.url), "utf8");
const processor = source.slice(source.indexOf("function processOneCommand("), source.indexOf("// ---- Bridge Control ----"));
describe("CEP reply publication after a project close", () => {
  it.each(['{"success":true,"data":{"closed":null}}', "", "EvalScript error."])("publishes reply despite missing panel elements: %s", result => {
    const writes: { file: string; content: string }[] = [], removed: string[] = [];
    let detached = false, released = false;
    const state: Record<string, unknown> = { tempDir: "/tmp/cep-reply", ENGINE_ID: "unit", commandInFlight: false, commandCount: 0, bridgeRunning: false,
      path: { join: (...parts: string[]) => parts.join("/") }, fs: { renameSync() {} }, readFile: () => "close script", deleteFile: (file: string) => removed.push(file),
      log: () => { if (detached) throw Error("Panel UI unavailable"); },
      setInterval: () => 1, clearInterval: () => { released = true; },
      writeFile() {}, writeResponseFile: (file: string, content: string) => writes.push({ file, content }),
      document: { getElementById: () => null },
      executeScript: (_script: string, callback: (reply: string) => void) => { detached = true; callback(result); },
    };
    expect(() => runInNewContext(`${processor}\nprocessOneCommand("cmd_1.jsx");`, state)).not.toThrow();
    expect(writes).toHaveLength(1);expect(writes[0].file).toBe("/tmp/cep-reply/res_1.json");
    expect(JSON.parse(writes[0].content).success).toBe(result.startsWith("{"));
    expect(state.commandInFlight).toBe(false);expect(released).toBe(true);expect(removed).not.toContain("/tmp/cep-reply/busy_1.json");
  });
  it("does not forge a reply or release execution when evalScript never returns", () => {
    let writes = 0;
    const state: Record<string, unknown> = { tempDir: "/tmp/cep-reply", ENGINE_ID: "unit", commandInFlight: false, commandCount: 0, bridgeRunning: false,
      path: { join: (...parts: string[]) => parts.join("/") }, fs: { renameSync() {} }, readFile: () => "close script", deleteFile() {},log() {},setInterval: () => 1,writeFile() {},writeResponseFile: () => writes++,executeScript() {}, };
    runInNewContext(`${processor}\nprocessOneCommand("cmd_1.jsx");`, state);
    expect(writes).toBe(0);expect(state.commandInFlight).toBe(true);
  });
  it.each(["", "EvalScript error."])("logs failed evalScript replies as errors: %s", result => {
    const logs: string[][] = [];
    const state: Record<string, unknown> = { tempDir: "/tmp/cep-reply", ENGINE_ID: "unit", commandInFlight: false, commandCount: 0, bridgeRunning: false,
      path: { join: (...parts: string[]) => parts.join("/") }, fs: { renameSync() {} }, readFile: () => "script", deleteFile() {},
      log: (...args: string[]) => logs.push(args), setInterval: () => 1, clearInterval() {}, writeFile() {}, writeResponseFile() {},
      document: { getElementById: () => null }, executeScript: (_script: string, callback: (reply: string) => void) => callback(result) };
    runInNewContext(`${processor}\nprocessOneCommand("cmd_1.jsx");`, state);
    expect(logs).toContainEqual(["Command failed", "err"]);
  });
});
