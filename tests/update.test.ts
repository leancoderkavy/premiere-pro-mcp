import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareVersions,
  latestVersionFromRegistry,
  normalizeVersion,
} from "../src/update.js";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("user update paths", () => {
  it("normalizes and compares released package versions", () => {
    expect(normalizeVersion("v1.14.4")).toBe("1.14.4");
    expect(normalizeVersion("1.14")).toBe("1.14.0");
    expect(normalizeVersion("not-a-version")).toBeUndefined();
    expect(compareVersions("1.15.0", "1.14.99")).toBe(1);
    expect(compareVersions("1.14.4", "1.14.4")).toBe(0);
    expect(compareVersions("1.14.3", "1.14.4")).toBe(-1);
  });

  it("accepts only the latest package version from the npm registry payload", () => {
    expect(latestVersionFromRegistry({ "dist-tags": { latest: "v1.14.4" } })).toBe("1.14.4");
    expect(() => latestVersionFromRegistry({ "dist-tags": { latest: "nightly" } })).toThrow("valid latest version");
  });

  it("exposes guarded global and source update commands", () => {
    const packageJson = JSON.parse(read("package.json"));
    const cli = read("src/index.ts");
    const sourceUpdater = read("scripts/update-source.mjs");

    expect(packageJson.scripts["update:source"]).toBe("node scripts/update-source.mjs");
    expect(packageJson.scripts["check-update:source"]).toBe("node scripts/update-source.mjs --check");
    expect(cli).toContain("--check-update");
    expect(cli).toContain("--update");
    expect(cli).toContain('"install", "--global", "premiere-pro-mcp@latest"');
    expect(cli).toContain("--install-cep");
    expect(sourceUpdater).toContain('const workingTreeDirty = Boolean(run("git", ["status", "--porcelain"]))');
    expect(sourceUpdater).toContain('runInherited("git", ["merge", "--ff-only", "@{upstream}"])');
    expect(sourceUpdater).toContain("runNpm([\"ci\"])");
    expect(sourceUpdater).toContain('["dist/index.js", "--install-cep"]');
  });
});
