import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MediaWatchRegistry } from "../../src/tools/media-watch.js";

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
});
