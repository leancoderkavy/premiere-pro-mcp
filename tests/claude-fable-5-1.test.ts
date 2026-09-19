import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { articles } from "../landing/lib/articles.js";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Claude Fable 5.1 support guidance", () => {
  const doc = read("docs/claude-fable-5-1.md");
  const readme = read("README.md");
  const article = articles.find((entry) => entry.slug === "claude-fable-5-1-premiere-pro-mcp");

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

  it("publishes a distinct landing guide without requiring Fable 5.1", () => {
    expect(article).toBeDefined();
    expect(article?.title).toBe("How to Use Claude Fable 5.1 with Premiere Pro MCP");
    expect(article?.keywords).toContain("Claude Fable 5.1 Premiere Pro");
    expect(article?.faqs.some((faq) => faq.question.includes("require Claude Fable 5.1"))).toBe(true);
    expect(article?.faqs.find((faq) => faq.question.includes("require Claude Fable 5.1"))?.answer).toMatch(/^No\./);
    expect(read("landing/public/llms.txt")).toContain(
      "https://premiere-pro-mcp.com/blog/claude-fable-5-1-premiere-pro-mcp/",
    );
    expect(read("landing/components/sections/setup-guides.tsx")).toContain(
      "/blog/claude-fable-5-1-premiere-pro-mcp/",
    );
  });
});
