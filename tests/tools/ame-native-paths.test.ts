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

describe("AME encode handoffs do not start the ready queue by default", () => {
  const projectItem = { nodeId: "item-1", name: "Clip", type: 1 };
  const project = {
    path: "saved.prproj",
    rootItem: { children: { numItems: 1, 0: projectItem } },
  };

  async function encodeScript(
    tool: "encode_project_item" | "encode_file" | "manage_proxies",
    startBatch?: boolean,
  ) {
    const dir = mkdtempSync(join(tmpdir(), "ame-encode-")); dirs.push(dir);
    vi.mocked(sendCommand).mockResolvedValue({ success: true, data: {} });
    const tools = getExportTools({ tempDir: dir, timeoutMs: 5000 });
    if (tool === "encode_project_item") {
      await tools.encode_project_item.handler({
        item_id: "item-1", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr", start_batch: startBatch,
      });
    } else if (tool === "encode_file") {
      await tools.encode_file.handler({
        input_path: "/tmp/source.mov", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr", start_batch: startBatch,
      });
    } else {
      await tools.manage_proxies.handler({
        item_id: "item-1", action: "create", output_path: "/tmp/proxy.mov", preset_path: "/tmp/proxy.epr", start_batch: startBatch,
      });
    }
    return vi.mocked(sendCommand).mock.calls.at(-1)![0] as string;
  }

  function runEncode(script: string, encoder: { startBatch: ReturnType<typeof vi.fn> }) {
    function Time(this: { seconds: number }) { this.seconds = 0; }
    function File(this: { exists: boolean; fsName: string; parent: { exists: boolean } }, path: string) {
      this.exists = true;
      this.fsName = path;
      this.parent = { exists: true };
    }
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      Time, File,
      app: { project, encoder },
    })));
  }

  it.each(["encode_project_item", "encode_file", "manage_proxies"] as const)(
    "%s enqueues only unless start_batch is true",
    async (tool) => {
      const idle = { launchEncoder: vi.fn(), encodeProjectItem: vi.fn(() => "job"), encodeFile: vi.fn(() => "job"), startBatch: vi.fn() };
      const queued = runEncode(await encodeScript(tool), idle);
      expect(idle.startBatch).not.toHaveBeenCalled();
      expect(queued).toMatchObject({ success: true, data: { accepted: true, verified: false, outcome: "committed_unverified", queueBatchStart: "not_requested" } });
      expect(queued.data.verificationScope).not.toContain("all ready AME jobs");

      const started = { launchEncoder: vi.fn(), encodeProjectItem: vi.fn(() => "job"), encodeFile: vi.fn(() => "job"), startBatch: vi.fn(() => true) };
      const requested = runEncode(await encodeScript(tool, true), started);
      expect(started.startBatch).toHaveBeenCalledOnce();
      expect(requested).toMatchObject({ success: true, data: { queueBatchStart: "requested", outcome: "committed_unverified", verified: false } });
      expect(requested.data.verificationScope).toContain("all ready AME jobs");
    },
  );
});
