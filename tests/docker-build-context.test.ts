import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker release build context", () => {
  it("copies every repository script required by the package build", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toContain("scripts/copy-adobe-uxp-coverage.mjs");
    expect(dockerfile).toContain(
      "COPY scripts/copy-adobe-uxp-coverage.mjs ./scripts/copy-adobe-uxp-coverage.mjs",
    );
  });
});
