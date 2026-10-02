import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

const dirs: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("AME handoff native paths", () => {
  async function prepare(startBatch?: boolean) {
    const dir = mkdtempSync(join(tmpdir(), "ame-native-")); dirs.push(dir);
    const preset = join(dir, "preset.epr"); writeFileSync(preset, "<preset />");
    const output = join(dir, "render.mp4");
    await getExportTools({ tempDir: dir, timeoutMs: 5000 }).add_to_render_queue.handler({
      output_path: output.split(sep).join("/"), preset_path: preset.split(sep).join("/"), start_batch: startBatch,
    });
    return { preset, output, script: vi.mocked(sendCommand).mock.calls.at(-1)![0] };
  }

  it("passes native output and preset paths to encoder and preserves unverified handoff", async () => {
    const { preset, output, script } = await prepare();
    const seen: string[] = [];
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn(() => "job"), startBatch: vi.fn() };
    const sequence = { name: "Sequence" };
    function File(this: any, path: string) { seen.push(path); this.fsName = path; this.exists = true; this.parent = { exists: true, fsName: "parent" }; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: sequence, path: "saved.prproj" }, encoder } })));
    expect(seen).toEqual([resolve(output), resolve(preset)]);
    expect(encoder.encodeSequence).toHaveBeenCalledWith(sequence, resolve(output), resolve(preset), 0, true);
    expect(result).toMatchObject({ success: true, data: { accepted: true, verified: false, outcome: "committed_unverified", queueBatchStart: "not_requested" } });
    expect(encoder.startBatch).not.toHaveBeenCalled();
  });

  it.each([true, 1])("starts every ready AME job only with opt-in and accepting host return %s", async accepted => {
    const { script } = await prepare(true);
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn(() => "job"), startBatch: vi.fn(() => accepted) };
    function File(this: any, path: string) { this.fsName = path; this.exists = true; this.parent = { exists: true, fsName: "parent" }; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: {}, path: "saved.prproj" }, encoder } })));
    expect(encoder.startBatch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: { queueBatchStart: "requested", outcome: "committed_unverified", verified: false } });
    expect(result.data.verificationScope).toContain("all ready AME jobs");
  });

  it.each([false, 0, undefined])("preserves queue handoff without claiming batch acceptance for %s", async accepted => {
    const { script } = await prepare(true);
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn(() => "job"), startBatch: vi.fn(() => accepted) };
    function File(this: any, path: string) { this.fsName = path; this.exists = true; this.parent = { exists: true, fsName: "parent" }; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: {}, path: "saved.prproj" }, encoder } })));
    expect(result).toMatchObject({ success: true, data: { accepted: true, queueBatchStart: "rejected", outcome: "committed_unverified" } });
    expect(result.data.verificationScope).not.toContain("accepted a request to start");
  });

  it("preserves the queue handoff when batch startup is unavailable", async () => {
    const { script } = await prepare(true);
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn(() => "job"), startBatch: vi.fn(() => { throw new Error("unavailable"); }) };
    function File(this: any, path: string) { this.fsName = path; this.exists = true; this.parent = { exists: true, fsName: "parent" }; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: {}, path: "saved.prproj" }, encoder } })));
    expect(result).toMatchObject({ success: true, data: { queueBatchStart: "unavailable: unavailable", outcome: "committed_unverified" } });
    expect(result.data.verificationScope).not.toContain("accepted a request to start");
  });

  it.each(["output", "preset"])("rejects missing host %s before launching encoder", async (missing) => {
    const { script } = await prepare();
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn() };
    let calls = 0;
    function File(this: any, path: string) { calls++; this.fsName = path; this.exists = missing !== "preset" || calls !== 2; this.parent = { exists: missing !== "output", fsName: "missing-directory" }; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: {}, path: "saved.prproj" }, encoder } })));
    expect(result.success).toBe(false);
    expect(result.error).toContain(missing === "output" ? "missing-directory" : "AME preset file does not exist");
    expect(encoder.launchEncoder).not.toHaveBeenCalled();
    expect(encoder.encodeSequence).not.toHaveBeenCalled();
  });

  it("rejects an output file without a parent before launching encoder", async () => {
    const { script } = await prepare();
    const encoder = { launchEncoder: vi.fn(), encodeSequence: vi.fn() };
    function File(this: any, path: string) { this.fsName = path; this.exists = false; this.parent = null; }
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { File, app: { project: { activeSequence: {}, path: "saved.prproj" }, encoder } })));
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("The requested AME output directory does not exist:");
    expect(encoder.launchEncoder).not.toHaveBeenCalled();
  });
});
