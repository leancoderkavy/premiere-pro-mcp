import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { runWithExpectedProject, expectedProjectPath, runWithExpectedHostTarget } from "../src/bridge/project-guard.js";
import { buildToolScript } from "../src/bridge/script-builder.js";
import { sendAfterEffectsCommand } from "../src/bridge/after-effects-bridge.js";

function execute(expected: string | undefined, active: string | undefined, os = "Macintosh") {
  const mutation = vi.fn();
  const script = runWithExpectedProject(expected, () => buildToolScript("mutation(); return __result({ done: true });"));
  const result = runInNewContext(script, {
    app: { project: active === undefined ? null : { path: active } }, $: { os },
    File: function (this: { fsName: string }, value: string) { this.fsName = value.replace(/\\/g, "/"); },
    __error: (error: string) => ({ success: false, error }), __refuse: (error: string) => ({ success: false, error }), __result: (data: unknown) => ({ success: true, data }), mutation,
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

describe("backend-scoped sequence and clip expected-state guard", () => {
  const target = { backend: "cep" as const, sequence_id: "sequence-1", clip: { node_id: "clip-1", track_type: "video" as const, track_index: 0, project_item_id: "source-1", start_ticks: "90071992547409930001", end_ticks: "90071992547409939999" } };
  function invoke(overrides: Record<string, unknown> = {}) {
    const mutation = vi.fn();
    const located = { clip: { nodeId: "clip-1", projectItem: { nodeId: "source-1" }, start: { ticks: target.clip.start_ticks }, end: { ticks: target.clip.end_ticks } }, trackType: "video", trackIndex: 0, ...overrides };
    const script = runWithExpectedHostTarget(target, () => buildToolScript("mutation(); return __result({ changed: true });"));
    const result = runInNewContext(script, { app: { project: { activeSequence: { sequenceID: overrides.sequenceID || "sequence-1" } } }, __findClip: () => overrides.missing ? null : located, __error: (error: string) => ({ success: false, error }), __result: (data: unknown) => ({ success: true, data }), mutation });
    return { result, mutation };
  }
  it("refuses switched sequences, moved/replaced clips and changed exact tick state before writes", () => {
    const rangeChanged = { nodeId: "clip-1", projectItem: { nodeId: "source-1" }, start: { ticks: "90071992547409930002" }, end: { ticks: target.clip.end_ticks } };
    for (const change of [{ sequenceID: "sequence-2" }, { missing: true }, { trackIndex: 1 }, { trackType: "audio" }, { clip: rangeChanged }]) {
      const value = invoke(change); expect(value.result.success).toBe(false); expect(value.mutation).not.toHaveBeenCalled();
    }
    expect(invoke().mutation).toHaveBeenCalledOnce();
  });
  it("refuses identities from another backend and malformed envelopes", () => {
    for (const value of [null, [], { ...target, backend: "uxp" }, { ...target, sequence_id: "" }, { ...target, extra: true }, { ...target, clip: { ...target.clip, track_index: -1 } }, { ...target, clip: { ...target.clip, start_ticks: "1.2" } }]) expect(() => runWithExpectedHostTarget(value, () => undefined)).toThrow(/expected_target/);
    expect(() => runWithExpectedHostTarget(undefined, () => undefined)).not.toThrow();
  });
});
