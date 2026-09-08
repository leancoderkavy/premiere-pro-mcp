import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing SEO intent cluster", () => {
  const articles = read("landing/lib/articles.ts");
  const llms = read("landing/public/llms.txt");

  it("maps each requested setup and AI-client intent to a distinct guide", () => {
    const guides = [
      {
        slug: "how-to-set-up-premiere-pro-mcp",
        phrase: "how to setup Premiere Pro MCP",
        title: "How to Set Up Premiere Pro MCP Safely",
      },
      {
        slug: "set-up-ai-in-premiere-pro",
        phrase: "how to setup Premiere Pro AI",
        title: "How to Set Up AI in Premiere Pro: A Practical Guide",
      },
      {
        slug: "claude-desktop-premiere-pro-mcp-setup",
        phrase: "Claude Premiere Pro",
        title: "How to Set Up Claude with Premiere Pro MCP",
      },
      {
        slug: "chatgpt-premiere-pro-mcp",
        phrase: "ChatGPT Premiere Pro",
        title: "ChatGPT + Premiere Pro: Connect MCP the Safe Way",
      },
      {
        slug: "codex-premiere-pro-mcp-setup",
        phrase: "Codex Premiere Pro",
        title: "How to Set Up Codex with Premiere Pro MCP",
      },
    ];

    for (const guide of guides) {
      expect(articles).toContain(`slug: "${guide.slug}"`);
      expect(articles).toContain(`"${guide.phrase}"`);
      expect(articles).toContain(`title: "${guide.title}"`);
      expect(llms).toContain(`https://premiere-pro-mcp.com/blog/${guide.slug}/`);
    }
  });

  it("keeps the guide routes discoverable through the generated sitemap", () => {
    const sitemap = read("landing/app/sitemap.ts");
    const articlePage = read("landing/app/blog/[slug]/page.tsx");

    expect(sitemap).toContain("...articles.map((article) => ({");
    expect(articlePage).toContain("generateStaticParams");
    expect(articlePage).toContain("alternates: { canonical:");
    expect(articlePage).toContain('"@type": "FAQPage"');
  });

  it("does not overstate ChatGPT's local connection path", () => {
    expect(articles).toContain(
      "ChatGPT's custom MCP-app route uses remote MCP servers; it does not directly attach to a local stdio server running beside Premiere.",
    );
    expect(articles).toContain(
      "The operator-managed Premiere Pro MCP instance is not a desktop relay for public users.",
    );
  });
});
