import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("npm release package verification", () => {
  it("checks the actual tarball and an isolated CLI installation before publication", () => {
    const packageJson = JSON.parse(read("package.json"));
    const verifier = read("scripts/verify-npm-package.mjs");

    expect(packageJson.scripts["pack:check"]).toBe("node scripts/verify-npm-package.mjs");
    expect(verifier).toContain('"package/dist/index.js"');
    expect(verifier).toContain('"package/cep-plugin/CSXS/manifest.xml"');
    expect(verifier).toContain('"package/uxp-plugin/manifest.json"');
    expect(verifier).toContain('"--ignore-scripts"');
    expect(verifier).toContain('installedCli, "--help"');
    expect(verifier).toContain("process.env.npm_execpath");
    expect(verifier).toContain('"lib", "node_modules", "npm"');
  });

  it("requires provenance and package verification in every npm publish path", () => {
    const publish = read(".github/workflows/npm-publish.yml");
    const crossPlatform = read(".github/workflows/cross-platform.yml");

    expect(publish).toContain("npm publish --provenance --access public");
    expect(publish).toContain("npm run pack:check");
    expect(crossPlatform).toContain("npm run pack:check");
  });
});
