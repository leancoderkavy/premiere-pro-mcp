import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("GPT-6 Sol/Luna and Claude Opus 5.5 guidance", () => {
  const readme = read("README.md");

  it("links both model docs from the README client section", () => {
    expect(readme).toContain("### GPT-6 Sol and GPT-6 Luna");
    expect(readme).toContain("docs/gpt-6-sol-luna.md");
    expect(readme).toContain("### Claude Opus 5.5");
    expect(readme).toContain("docs/claude-opus-5-5.md");
  });

  it("keeps model selection in the client and states the validation boundary", () => {
    const sol = read("docs/gpt-6-sol-luna.md");
    const opus = read("docs/claude-opus-5-5.md");
    expect(sol).toContain("The server does not run an OpenAI model itself.");
    expect(sol).toContain("`gpt-6-sol`");
    expect(sol).toContain("`gpt-6-luna`");
    expect(opus).toContain("The server does not run an Anthropic model itself.");
    expect(opus).toContain("`claude-opus-5-5`");
    for (const doc of [sol, opus]) {
      expect(doc).toContain("Serialize work sharing Premiere state");
      expect(doc).toMatch(/prove\s+licensed-Premiere\s+execution/);
    }
  });
});
