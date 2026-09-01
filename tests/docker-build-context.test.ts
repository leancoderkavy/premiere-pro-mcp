import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker release build context", () => {
  it("copies every repository script required by the package build", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    const buildScripts = [...packageJson.scripts.build.matchAll(/scripts\/[\w-]+\.mjs/g)]
      .map((match) => match[0]);
    expect(buildScripts).toEqual([
      "scripts/generate-adobe-api-inventory.mjs",
      "scripts/generate-uxp-js-api-inventory.mjs",
      "scripts/generate-premiere-doc-inventory.mjs",
      "scripts/copy-adobe-uxp-coverage.mjs",
    ]);
    for (const script of buildScripts) {
      expect(dockerfile).toContain(`COPY ${script} ./${script}`);
    }
  });
});
