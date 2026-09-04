import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaWatchRegistry, getMediaWatchTools } from "../../src/tools/media-watch.js";

const registries: MediaWatchRegistry[] = [];
afterEach(() => registries.splice(0).forEach((registry) => registry.close()));
describe("media watch", () => {
  it("proposes new media without disclosing paths by default", () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    writeFileSync(path.join(root, "existing.mp4"), "old");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    writeFileSync(path.join(root, "new.mp4"), "new");
    const preview = registry.preview({ watch_id: started.watch_id }) as any;
    expect(preview.proposed_count).toBe(1);
    expect(preview.proposed_imports[0]).not.toHaveProperty("media_path");
    expect(preview.applied).toBe(false);
  });
  it("supports disclosure, rescan, stop, and handler failures", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-"));
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: [".MP4"], recursive: false }) as any;
    writeFileSync(path.join(root, "new.mp4"), "new");
    const preview = registry.preview({ watch_id: started.watch_id, include_paths: true, known_media_path_hashes: [] }) as any;
    expect(preview.proposed_imports[0].media_path).toContain("new.mp4");
    expect((registry.rescan() as any).baseline_file_count).toBe(1);
    registry.close(); expect(registry.status()).toMatchObject({ active: false });
    expect(() => registry.preview({ watch_id: started.watch_id })).toThrow(/no media watch/);
  });
  it("rejects unsafe starts and stale preview arguments", () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), outside = mkdtempSync(path.join(tmpdir(), "outside-"));
    const registry = new MediaWatchRegistry(); registries.push(registry);
    expect(() => registry.start({ approved_workspace_path: root, watch_path: outside, allowed_extensions: ["mp4"] })).toThrow(/contained/);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    expect(() => registry.start({})).toThrow(/already active/);
    expect(() => registry.preview({ watch_id: "wrong" })).toThrow(/does not match/);
    expect(() => registry.preview({ watch_id: started.watch_id, include_paths: "yes" })).toThrow(/boolean/);
    expect(() => registry.preview({ watch_id: started.watch_id, known_media_path_hashes: ["bad"] })).toThrow(/sha256/);
  });
  it("validates paths, extensions, recursion, bins, and inactive scans", () => {
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
    ]) expect(() => new MediaWatchRegistry().start(args)).toThrow();
    expect(() => new MediaWatchRegistry().rescan()).toThrow(/no media watch/);
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
  it("filters known hashes and proposes changed baseline files to a bin", () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), file = path.join(root, "clip.mp4"); writeFileSync(file, "a");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], target_bin_id: "bin" }) as any;
    writeFileSync(file, "changed-size");
    const first = registry.preview({ watch_id: started.watch_id }) as any, hash = first.proposed_imports[0].path_hash;
    expect(first.proposed_imports[0].target_bin_id).toBe("bin");
    expect((registry.preview({ watch_id: started.watch_id, known_media_path_hashes: [hash] }) as any).proposed_count).toBe(0);
    expect(() => registry.preview({ watch_id: started.watch_id, known_media_path_hashes: "bad" })).toThrow(/at most 5000/);
  });
  it("does not propose an unchanged baseline file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")); writeFileSync(path.join(root, "clip.mp4"), "same");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"] }) as any;
    expect((registry.preview({ watch_id: started.watch_id }) as any).proposed_count).toBe(0);
  });
  it("detects same-size timestamp changes and recursively scans subfolders", () => {
    const root = mkdtempSync(path.join(tmpdir(), "premiere-watch-")), nested = path.join(root, "nested"); mkdirSync(nested);
    const file = path.join(nested, "clip.mp4"); writeFileSync(file, "same");
    const registry = new MediaWatchRegistry(); registries.push(registry);
    const started = registry.start({ approved_workspace_path: root, watch_path: root, allowed_extensions: ["mp4"], recursive: true }) as any;
    const changed = new Date(Date.now() + 10_000); utimesSync(file, changed, changed);
    expect((registry.preview({ watch_id: started.watch_id }) as any).proposed_count).toBe(1);
  });
});
