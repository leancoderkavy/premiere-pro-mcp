import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { runWithExpectedProject, expectedProjectPath } from "../src/bridge/project-guard.js";
import { buildToolScript } from "../src/bridge/script-builder.js";
import { sendAfterEffectsCommand } from "../src/bridge/after-effects-bridge.js";

function execute(expected: string | undefined, active: string | undefined, os = "Macintosh") {
  const mutation = vi.fn();
  const script = runWithExpectedProject(expected, () => buildToolScript("mutation(); return __result({ done: true });"));
  const result = runInNewContext(script, {
    app: { project: active === undefined ? null : { path: active } }, $: { os },
    File: function (this: { fsName: string }, value: string) { this.fsName = value.replace(/\\/g, "/"); },
    __error: (error: string) => ({ success: false, error }), __result: (data: unknown) => ({ success: true, data }), mutation,
  });
  return { result, mutation, script };
}

describe("request-scoped expected project guard", () => {
  it("refuses the wrong or unsaved active project before mutation", () => {
    for (const active of ["/decoy.prproj", "", undefined]) {
      const value = execute("/target.prproj", active);
      expect(value.result).toMatchObject({ success: false, error: expect.stringContaining("nothing was changed") });
      expect(value.mutation).not.toHaveBeenCalled();
    }
  });
  it("allows matching saved projects and preserves unguarded behavior", () => {
    expect(execute("/target.prproj", "/target.prproj").mutation).toHaveBeenCalledOnce();
    expect(execute(undefined, undefined).mutation).toHaveBeenCalledOnce();
    expect(execute("C:\\Projects\\Target.prproj", "c:/projects/target.prproj", "Windows 11").mutation).toHaveBeenCalledOnce();
    expect(execute("/Target.prproj", "/target.prproj").mutation).not.toHaveBeenCalled();
  });
  it("escapes names before embedding them in host code", () => {
    const value = execute('/project"\u2028name.prproj', '/project"\u2028name.prproj');
    expect(value.mutation).toHaveBeenCalledOnce();
    expect(value.script).toContain('\\u2028');
  });
  it.each(["relative.prproj", "", null, 42, "/bad\npath", "/" + "a".repeat(4096)])("rejects invalid guard %j", (value) => {
    expect(() => runWithExpectedProject(value, () => undefined)).toThrow(/absolute saved-project path/);
  });
  it("keeps concurrent async request scopes isolated and clears after completion", async () => {
    const paths = await Promise.all(["/first.prproj", "/second.prproj"].map((path) => runWithExpectedProject(path, async () => {
      await Promise.resolve();
      return expectedProjectPath();
    })));
    expect(paths).toEqual(["/first.prproj", "/second.prproj"]);
    expect(expectedProjectPath()).toBeUndefined();
  });
  it("refuses the guard on the separate After Effects bridge", async () => {
    await expect(runWithExpectedProject("/target.prproj", () => sendAfterEffectsCommand("unused")))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("After Effects") });
  });
});
