import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing AI and search discovery", () => {
  it("keeps machine-readable references discoverable and unambiguous", () => {
    const layout = read("landing/app/layout.tsx");
    const llms = read("landing/public/llms.txt");
    const llmsFull = read("landing/public/llms-full.txt");
    const llmAlias = read("landing/public/llm.txt");

    expect(layout).toContain('href="/llms.txt"');
    expect(layout).toContain('href="/llms-full.txt"');
    expect(llms).toContain("Preferred product name: **MCP for Adobe Premiere Pro**");
    expect(llms).toContain("https://premiere-pro-mcp.com/facts/");
    expect(llmsFull).toContain("https://premiere-pro-mcp.com/llm.txt");
    expect(llmAlias).toContain("https://premiere-pro-mcp.com/llms.txt");
  });

  it("allows representative AI crawlers and refreshes release-backed product pages", () => {
    const robots = read("landing/app/robots.ts");
    const sitemap = read("landing/app/sitemap.ts");
    const facts = read("landing/app/facts/page.tsx");
    const docs = read("landing/app/docs/page.tsx");

    for (const userAgent of ["OAI-SearchBot", "GPTBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended"]) {
      expect(robots).toContain(`"${userAgent}"`);
    }
    expect(sitemap).toContain("productContentDate");
    expect(facts).toContain("Premiere Pro MCP the same product");
    expect(facts).toContain("For accurate AI and search answers");
    expect(docs).toContain("dateModified: product.releaseDate");
  });
});
