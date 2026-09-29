import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Claude Fable 5.1 support guidance", () => {
  const doc = read("docs/claude-fable-5-1.md");
  const readme = read("README.md");

  it("keeps the repository doc linked from the README client section", () => {
    expect(readme).toContain("### Claude Fable 5.1");
    expect(readme).toContain("docs/claude-fable-5-1.md");
    expect(readme).toContain("claude-fable-5-1");
    expect(doc).toContain("The server does not run an Anthropic model itself.");
  });

  it("states the privacy, serialization, and licensed-host boundaries", () => {
    expect(doc).toContain("Anthropic data-retention policy");
    expect(doc).toContain("Serialize work sharing Premiere state");
    expect(doc).toContain("They do not measure Fable 5.1's editing quality or prove licensed-Premiere");
    expect(doc).toContain("Cursor may route a request to Claude Opus");
  });

});
