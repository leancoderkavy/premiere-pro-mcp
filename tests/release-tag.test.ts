import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const release = JSON.parse(read("release-metadata.json"));

function verify(tag?: string) {
  return spawnSync(process.execPath, ["scripts/verify-release-tag.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: tag ?? "" },
  });
}

describe("release tag verification", () => {
  it("accepts only the exact canonical tag and aligned distributable manifests", () => {
    expect(verify(`v${release.version}`)).toMatchObject({
      status: 0,
      stdout: expect.stringContaining(`v${release.version}`),
    });
    expect(verify(`v${release.version}.1`)).toMatchObject({
      status: 1,
      stderr: expect.stringContaining("Release tag must be exactly"),
    });
    expect(verify()).toMatchObject({
      status: 1,
      stderr: expect.stringContaining("Release tag must be exactly"),
    });
  });

  it("gates every release attachment workflow on the matching release tag", () => {
    for (const workflow of [
      ".github/workflows/cep-release.yml",
      ".github/workflows/uxp-package.yml",
      ".github/workflows/claude-desktop-bundle.yml",
    ]) {
      const source = read(workflow);
      expect(source).toContain("npm run check");
      expect(source).toContain("RELEASE_TAG: ${{ github.event.release.tag_name }}");
      expect(source).toContain("node scripts/verify-release-tag.mjs");
    }
  });
});
