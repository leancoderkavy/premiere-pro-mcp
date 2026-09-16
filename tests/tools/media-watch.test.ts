import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaWatchRegistry, getMediaWatchTools } from "../../src/tools/media-watch.js";

const registries: MediaWatchRegistry[] = [];
afterEach(() => {
  registries.splice(0).forEach((registry) => registry.close());
  vi.restoreAllMocks();
});
describe("media watch", () => {
  it("proposes new media without disclosing paths by default", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    writeFileSync(path.join(root, "existing.mp4"), "old");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    writeFileSync(path.join(root, "new.mp4"), "new");
    const preview = await registry.preview({ watch_id: started.watch_id }) as any;
    expect(preview.proposed_count).toBe(1);
    expect(preview.proposed_imports[0]).not.toHaveProperty("media_path");
    expect(preview.applied).toBe(false);
  });
  it("supports disclosure, rescan, stop, and handler failures", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: [".MP4"], recursive: false }) as any;
    writeFileSync(path.join(root, "new.mp4"), "new");
    const preview = await registry.preview({ watch_id: started.watch_id, include_paths: true, known_media_path_hashes: [] }) as any;
    expect(preview.proposed_imports[0].media_path).toContain("new.mp4");
    expect(((await registry.rescan()) as any).baseline_file_count).toBe(1);
    registry.close(); expect(registry.status()).toMatchObject({ active: false });
    await expect(registry.preview({ watch_id: started.watch_id })).rejects.toThrow(/no media watch/);
  });
  it("rejects unsafe starts and stale preview arguments", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), outside = mkdtempSync(path.join(tmpdir(), "outside-"));
    const registry = new MediaWatchRegistry(); registries.push(registry);
    await expect(registry.start({ approved_workspace_path: root, watch_path: outside, allowed_extensions: ["mp4"] })).rejects.toThrow(/contained/);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    await expect(registry.start({})).rejects.toThrow(/already active/);
    await expect(registry.preview({ watch_id: "wrong" })).rejects.toThrow(/does not match/);
    await expect(registry.preview({ watch_id: started.watch_id, include_paths: "yes" })).rejects.toThrow(/boolean/);
    await expect(registry.preview({ watch_id: started.watch_id, known_media_path_hashes: ["bad"] })).rejects.toThrow(/sha256/);
  });
  it("validates paths, extensions, recursion, bins, and inactive scans", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    for (const args of [
      { approved_workspace_path: "relative", watch_path: root, allowed_extensions: ["mp4"] },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: [] },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: [1] },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: ["bad!"] },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4", ".MP4"] },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: "yes" },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], target_bin_id: "" },
      { approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], target_bin_id: "x".repeat(513) },
    ]) await expect(new MediaWatchRegistry().start(args)).rejects.toThrow();
    await expect(new MediaWatchRegistry().rescan()).rejects.toThrow(/no media watch/);
  });
  it("routes every management action through the public handlers", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), registry = new MediaWatchRegistry(); registries.push(registry);
    const tools = getMediaWatchTools(registry);
    const started = await tools.manage_media_watch.handler({ action: "start", approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    expect((await tools.manage_media_watch.handler({ action: "status" })).success).toBe(true);
    expect((await tools.manage_media_watch.handler({ action: "scan" })).success).toBe(true);
    expect((await tools.preview_watched_media_import.handler({ watch_id: started.data.watch_id })).success).toBe(true);
    expect((await tools.manage_media_watch.handler({ action: "unknown" })).success).toBe(false);
    expect((await tools.manage_media_watch.handler({ action: "stop" })).success).toBe(true);
    expect((await tools.preview_watched_media_import.handler({ watch_id: started.data.watch_id })).success).toBe(false);
  });
  it("filters known hashes and proposes changed baseline files to a bin", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), file = path.join(root, "clip.mp4"); writeFileSync(file, "a");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], target_bin_id: "bin" }) as any;
    writeFileSync(file, "changed-size");
    const first = await registry.preview({ watch_id: started.watch_id }) as any, hash = first.proposed_imports[0].path_hash;
    expect(first.proposed_imports[0].target_bin_id).toBe("bin");
    expect(((await registry.preview({ watch_id: started.watch_id, known_media_path_hashes: [hash] })) as any).proposed_count).toBe(0);
    await expect(registry.preview({ watch_id: started.watch_id, known_media_path_hashes: "bad" })).rejects.toThrow(/at most 5000/);
  });
  it("does not propose an unchanged baseline file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")); writeFileSync(path.join(root, "clip.mp4"), "same");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    expect(((await registry.preview({ watch_id: started.watch_id })) as any).proposed_count).toBe(0);
  });
  it("detects same-size timestamp changes and recursively scans subfolders", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), nested = path.join(root, "nested"); mkdirSync(nested);
    const file = path.join(nested, "clip.mp4"); writeFileSync(file, "same");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true }) as any;
    const changed = new Date(Date.now() + 10_000); utimesSync(file, changed, changed);
    expect(((await registry.preview({ watch_id: started.watch_id })) as any).proposed_count).toBe(1);
  });

  it.each([
    ["file_limit", { maxFiles: 1 }, ["one.mp4", "two.mp4"]],
    ["entry_limit", { maxEntries: 2 }, ["one.txt", "two.txt", "three.txt"]],
    ["directory_limit", { maxDirectories: 1 }, ["one", "two", "three"]],
    ["queue_limit", { maxQueue: 1 }, ["one", "two", "three"]],
  ])("reports %s truncation instead of traversing an unbounded tree", async (reason, scanLimits, names) => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    for (const name of names) {
      if (name.includes(".")) writeFileSync(path.join(root, name), "fixture");
      else mkdirSync(path.join(root, name));
    }
    const registry = new MediaWatchRegistry({ scanLimits: { ...scanLimits, maxElapsedMs: 5_000 } }); registries.push(registry);

    const status = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true }) as any;

    expect(status.scan_incomplete).toBe(true);
    expect(status.scan_limit_reasons).toContain(reason);
  });

  it("bounds recursive depth and elapsed scan time", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    const nested = path.join(root, "one"); mkdirSync(nested); mkdirSync(path.join(nested, "two"));
    const depthRegistry = new MediaWatchRegistry({ scanLimits: { maxDepth: 1, maxElapsedMs: 5_000 } }); registries.push(depthRegistry);
    const depthStatus = await depthRegistry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true }) as any;
    expect(depthStatus.scan_limit_reasons).toContain("depth_limit");
    depthRegistry.close();

    const timeRegistry = new MediaWatchRegistry({ scanLimits: { maxElapsedMs: 0 } }); registries.push(timeRegistry);
    const timeStatus = await timeRegistry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true }) as any;
    expect(timeStatus.scan_limit_reasons).toContain("time_limit");
  });

  it("stops a wide directory when the cooperative elapsed budget expires between entries", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    writeFileSync(path.join(root, "one.txt"), "ignored");
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(2);
    const registry = new MediaWatchRegistry({ scanLimits: { maxElapsedMs: 1 } }); registries.push(registry);

    const status = await registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;

    expect(status.scan_limit_reasons).toContain("time_limit");
    expect(status.scan_visited_entry_count).toBe(0);
  });

  it("does not allow callers to disable or raise production traversal ceilings", () => {
    expect(() => new MediaWatchRegistry({ scanLimits: { maxEntries: 0 } })).toThrow(/positive safe integer/);
    expect(() => new MediaWatchRegistry({ scanLimits: { maxEntries: 25_001 } })).toThrow(/production limit/);
  });

  it("cancels an in-flight asynchronous scan when the registry closes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    const registry = new MediaWatchRegistry({ scanLimits: { yieldEveryEntries: 1 } }); registries.push(registry);

    const starting = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true });
    registry.close();

    await expect(starting).rejects.toThrow(/cancelled/);
  });

  it("does not publish preview or rescan results after the watch closes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    const previewRegistry = new MediaWatchRegistry({ scanLimits: { yieldEveryEntries: 1 } }); registries.push(previewRegistry);
    const started = await previewRegistry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    const preview = previewRegistry.preview({ watch_id: started.watch_id });
    previewRegistry.close();
    await expect(preview).rejects.toThrow(/cancelled/);

    const rescanRegistry = new MediaWatchRegistry({ scanLimits: { yieldEveryEntries: 1 } }); registries.push(rescanRegistry);
    await rescanRegistry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] });
    const rescan = rescanRegistry.rescan();
    rescanRegistry.close();
    await expect(rescan).rejects.toThrow(/cancelled/);
  });
});
