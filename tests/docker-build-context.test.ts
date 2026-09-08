import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker release build context", () => {
  it("provides the source metadata and generator used by the landing prebuild", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("COPY release-metadata.json ./release-metadata.json");
    expect(dockerfile).toContain("COPY scripts/generate-marketing-reference.mjs ./scripts/generate-marketing-reference.mjs");
    expect(dockerfile).toContain("WORKDIR /app/landing");
    expect(dockerfile).toContain("COPY --from=landing-builder /app/landing/out ./landing-dist");
  });
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
      "scripts/copy-adobe-uxp-coverage.mjs",
    ]);
    for (const script of buildScripts) {
      expect(dockerfile).toContain(`COPY ${script} ./${script}`);
    }
    for (const generator of buildScripts.filter((script) => script.includes("/generate-"))) {
      expect(packageJson.scripts.build).toContain(`${generator} --check`);
    }
  });
});
