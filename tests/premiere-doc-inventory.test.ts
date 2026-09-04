import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/premiere-doc-inventory.json", "utf8"));

describe("Adobe Premiere UXP documentation inventory", () => {
  it("accounts for every page and every public surface family", () => {
    expect(inventory.source.sitemapUrl).toBe("https://developer.adobe.com/sitemap.xml");
    expect(inventory.stats.total).toBe(inventory.pages.length);
    expect(Object.values(inventory.stats.bySurface).reduce((sum: number, count) => sum + Number(count), 0))
      .toBe(inventory.stats.total);
    expect(new Set(inventory.pages.map((page: { url: string }) => page.url)).size).toBe(inventory.pages.length);
    expect(Object.keys(inventory.stats.bySurface)).toEqual([
      "premiere-dom",
      "premiere-uxp-supporting-docs",
      "spectrum-web-components",
      "uxp-css",
      "uxp-html",
      "uxp-javascript",
      "uxp-plugin-guides",
    ]);
    for (const page of inventory.pages) {
      expect(page.url).toMatch(/^https:\/\/developer\.adobe\.com\/premiere-pro\/uxp\//);
      expect(page.lastModified === null || /^\d{4}-\d{2}-\d{2}$/.test(page.lastModified)).toBe(true);
    }
  });

  it("validates the committed snapshot without refetching the live sitemap", () => {
    const result = spawnSync(process.execPath, ["scripts/generate-premiere-doc-inventory.mjs", "--check"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PREMIERE_DOC_SITEMAP_PATH: join(tmpdir(), "missing-premiere-doc-sitemap.xml"),
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Premiere documentation inventory is current:");
  });

  it.each([
    ["empty", "<urlset></urlset>", "no URL entries"],
    ["missing location", "<urlset><url><lastmod>2026-09-01</lastmod></url></urlset>", "no location"],
    ["bad date", "<urlset><url><loc>https://developer.adobe.com/premiere-pro/uxp/plugins/</loc><lastmod>today</lastmod></url></urlset>", "Invalid Adobe sitemap lastmod"],
    ["impossible date", "<urlset><url><loc>https://developer.adobe.com/premiere-pro/uxp/plugins/</loc><lastmod>2026-02-31</lastmod></url></urlset>", "Invalid Adobe sitemap lastmod"],
    ["duplicate", "<urlset><url><loc>https://developer.adobe.com/premiere-pro/uxp/plugins/</loc></url><url><loc>https://developer.adobe.com/premiere-pro/uxp/plugins/</loc></url></urlset>", "duplicate"],
  ])("fails closed for a %s sitemap", (_label, sitemap, expectedError) => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-doc-inventory-"));
    const fixture = join(directory, "sitemap.xml");
    writeFileSync(fixture, sitemap);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-premiere-doc-inventory.mjs", "--validate-only"], {
        encoding: "utf8",
        env: { ...process.env, PREMIERE_DOC_SITEMAP_PATH: fixture },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("decodes XML entities once without double-unescaping nested text", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-doc-inventory-"));
    const fixture = join(directory, "sitemap.xml");
    const output = join(directory, "inventory.json");
    const nestedEntityUrl = "https://developer.adobe.com/premiere-pro/uxp/plugins/?value=&amp;amp;";
    writeFileSync(fixture, `<urlset><url><loc>${nestedEntityUrl}</loc></url></urlset>`);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-premiere-doc-inventory.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_DOC_SITEMAP_PATH: fixture,
          PREMIERE_DOC_INVENTORY_OUTPUT_PATH: output,
        },
      });
      expect(result.status).toBe(0);
      const generated = JSON.parse(readFileSync(output, "utf8"));
      expect(generated.pages).toHaveLength(1);
      expect(generated.pages[0].url).toBe("https://developer.adobe.com/premiere-pro/uxp/plugins/?value=&amp;");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("classifies a representative URL from every documentation branch", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-doc-inventory-"));
    const fixture = join(directory, "sitemap.xml");
    const output = join(directory, "inventory.json");
    const expected = new Map([
      ["https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project", "premiere-dom"],
      ["https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-js/Modules/uxp/", "uxp-javascript"],
      ["https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-html/HTML%20Elements/", "uxp-html"],
      ["https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-css/General/", "uxp-css"],
      ["https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-spectrum/spectrum-to-swc-mapping/", "spectrum-web-components"],
      ["https://developer.adobe.com/premiere-pro/uxp/plugins/concepts/manifest/", "uxp-plugin-guides"],
      ["https://developer.adobe.com/premiere-pro/uxp/resources/migration-guides/", "premiere-uxp-supporting-docs"],
    ]);
    const sitemap = `<urlset>${[...expected.keys()].map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
    writeFileSync(fixture, sitemap);
    try {
      const result = spawnSync(process.execPath, ["scripts/generate-premiere-doc-inventory.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PREMIERE_DOC_SITEMAP_PATH: fixture,
          PREMIERE_DOC_INVENTORY_OUTPUT_PATH: output,
        },
      });
      expect(result.status).toBe(0);
      const generated = JSON.parse(readFileSync(output, "utf8"));
      expect(new Map(generated.pages.map((page: { url: string; surface: string }) => [page.url, page.surface])))
        .toEqual(expected);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
