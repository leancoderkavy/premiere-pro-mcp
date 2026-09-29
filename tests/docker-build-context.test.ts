import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker release build context", () => {
  it("builds only the MCP server; the website ships from its own repository", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).not.toMatch(/landing/i);
    expect(dockerfile).not.toContain("generate-marketing-reference");
    expect(dockerfile).toContain("COPY --from=mcp-builder /app/dist ./dist");
    expect(dockerfile).toContain('CMD ["node", "dist/http-server.js"]');
    expect(dockerfile).toContain("USER node");
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

  it("keeps secret files in the Docker ignore list without stale website entries", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8");
    expect(dockerignore).not.toMatch(/landing/);
    expect(dockerignore).toMatch(/^\*\*\/\.env\*$/m);
  });
});
