import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sitemapUrl = "https://developer.adobe.com/sitemap.xml";
const outputPath = resolve("src/resources/premiere-doc-inventory.json");
const check = process.argv.includes("--check");
const validateOnly = process.argv.includes("--validate-only");

async function loadSitemap() {
  if (process.env.PREMIERE_DOC_SITEMAP_PATH) {
    return readFile(resolve(process.env.PREMIERE_DOC_SITEMAP_PATH), "utf8");
  }
  const response = await fetch(sitemapUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Adobe sitemap request failed: HTTP ${response.status}`);
  return response.text();
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function classify(url) {
  const path = new URL(url).pathname;
  if (path.includes("/ppro-reference/")) return "premiere-dom";
  if (path.includes("/uxp-api/reference-js/")) return "uxp-javascript";
  if (path.includes("/uxp-api/reference-html/")) return "uxp-html";
  if (path.includes("/uxp-api/reference-css/")) return "uxp-css";
  if (path.includes("/uxp-api/reference-spectrum/")) return "spectrum-web-components";
  if (path.includes("/plugins/")) return "uxp-plugin-guides";
  return "premiere-uxp-supporting-docs";
}

const sitemap = await loadSitemap();
const urlBlocks = [...sitemap.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/g)].map((match) => match[1]);
if (urlBlocks.length === 0) throw new Error("Adobe sitemap contained no URL entries");
const pages = [];
for (const block of urlBlocks) {
  const location = block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1]?.trim();
  if (!location) throw new Error("Adobe sitemap URL entry has no location");
  const url = decodeXml(location);
  if (!url.startsWith("https://developer.adobe.com/premiere-pro/uxp/")) continue;
  const lastModified = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1]?.trim() ?? null;
  if (lastModified !== null && !/^\d{4}-\d{2}-\d{2}$/.test(lastModified)) {
    throw new Error(`Invalid Adobe sitemap lastmod for ${url}: ${lastModified}`);
  }
  pages.push({ url, surface: classify(url), lastModified });
}
pages.sort((left, right) => left.url.localeCompare(right.url));
if (pages.length === 0) throw new Error("Adobe sitemap contained no Premiere UXP pages");
if (new Set(pages.map((page) => page.url)).size !== pages.length) {
  throw new Error("Adobe sitemap contains duplicate Premiere UXP URLs");
}
const counts = Object.fromEntries(
  [...new Set(pages.map((page) => page.surface))].sort().map((surface) => [
    surface,
    pages.filter((page) => page.surface === surface).length,
  ]),
);
const inventory = {
  schemaVersion: 1,
  source: { sitemapUrl },
  semantics: {
    listed: "The page appears in Adobe's live developer sitemap; this inventories documentation and does not prove API implementation or host behavior.",
  },
  stats: { total: pages.length, bySurface: counts },
  pages,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;

if (validateOnly) {
  console.log(`Validated ${pages.length} Adobe Premiere UXP documentation pages.`);
} else if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("Premiere documentation inventory is stale. Run npm run premiere:docs-inventory.");
    process.exitCode = 1;
  } else {
    console.log(`Premiere documentation inventory is current: ${pages.length} pages.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${pages.length} Adobe Premiere UXP documentation pages.`);
}
