import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("quick-start localization foundation", () => {
  it("keeps translated quick starts structurally aligned with the English source", () => {
    const output = execFileSync(process.execPath, ["scripts/check-quickstart-locales.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("2 translations");
  });

  it("links the README proof path without calling an illustration a live screenshot", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain("premiere-pro-mcp-demo-poster.png");
    expect(readme).toContain("not a Premiere panel screenshot or licensed-host proof");
    expect(readme).toContain("docs/quickstart/README.md");
  });
});
