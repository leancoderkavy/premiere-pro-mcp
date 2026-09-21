import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

const STUBS = [
  "CLAUDE.md",
  "GEMINI.md",
  "CONVENTIONS.md",
  ".github/copilot-instructions.md",
  ".windsurf/rules/repo.md",
  ".continue/rules/repo.md",
  ".junie/guidelines.md",
  ".clinerules",
];

describe("coding-agent instruction stubs", () => {
  it("keeps adapter stubs thin and pointed at AGENTS.md", () => {
    for (const path of STUBS) {
      const text = read(path);
      expect(text, path).toMatch(/AGENTS\.md/);
      expect(text.split(/\r?\n/).length, path).toBeLessThanOrEqual(12);
      expect(text, path).not.toMatch(/src\/server\.ts/);
      expect(text, path).not.toMatch(/ECMAScript 3/);
    }
  });

  it("keeps the Jev surface map optional and protocol-free", () => {
    const rule = read(".cursor/rules/jev-surfaces.mdc");
    expect(rule).toMatch(/alwaysApply:\s*false/);
    expect(rule).toContain("landing");
    expect(rule).toContain("uxp-plugin");
    expect(rule).not.toMatch(/first tool/i);
    expect(rule).not.toContain("jev-orchestrate");
    expect(rule).not.toContain("OPENROUTER");
  });

  it("pins client CEP install commands to the published package", () => {
    const version = readJson("landing/lib/published-release.json").version as string;
    const pin = `npx -y premiere-pro-mcp@${version} --install-cep`;
    for (const path of [
      "plugins/premiere-pro/skills/edit-premiere-project/SKILL.md",
      "claude-plugins/premiere-pro/skills/edit-premiere-project/SKILL.md",
      "README.md",
    ]) {
      expect(read(path), path).toContain(pin);
    }
    expect(read("README.md")).toContain(`premiere-pro-mcp@${version}`);
  });
});
