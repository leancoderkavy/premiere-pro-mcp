import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const output = fileURLToPath(new URL("../out/", import.meta.url));
const origin = "https://premiere-pro-mcp.com";
const sitemap = readFileSync(resolve(output, "sitemap.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]));
assert(urls.length > 0, "Sitemap has no pages");
const pages = new Map();
const titles = new Set();
const descriptions = new Set();
const htmlFile = (path) => resolve(output, `.${path}`, "index.html");
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map(([tag]) => tag);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
for (const url of urls) {
  assert.equal(url.origin, origin, `Unexpected sitemap origin: ${url}`);
  assert(!pages.has(url.pathname), `Duplicate sitemap URL: ${url}`);
  const html = readFileSync(htmlFile(url.pathname), "utf8");
  pages.set(url.pathname, html);
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
  assert(title && !titles.has(title), `Missing or duplicate title: ${url}`);
  titles.add(title);
  const metadata = tags(html, "meta");
  const description = attr(metadata.find((tag) => attr(tag, "name") === "description") ?? "", "content");
  assert(description && !descriptions.has(description), `Missing or duplicate description: ${url}`);
  descriptions.add(description);
  assert(!metadata.some((tag) => ["robots", "googlebot"].includes(attr(tag, "name")) && /noindex/i.test(attr(tag, "content") ?? "")), `Noindex: ${url}`);
  const canonical = tags(html, "link").filter((tag) => attr(tag, "rel") === "canonical");
  assert.equal(canonical.length, 1, `Expected one canonical: ${url}`);
  assert.equal(attr(canonical[0], "href"), url.href, `Wrong canonical: ${url}`);
  assert.equal(tags(html, "h1").length, 1, `Expected one H1: ${url}`);
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) JSON.parse(match[1]);
}
let checkedLinks = 0;
for (const [path, html] of pages) {
  for (const tag of tags(html, "a")) {
    const href = attr(tag, "href");
    if (!href) continue;
    const target = new URL(href.replaceAll("&amp;", "&"), `${origin}${path}`);
    if (target.origin !== origin) continue;
    const route = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
    const targetHtml = pages.get(route);
    assert(targetHtml || existsSync(resolve(output, `.${decodeURIComponent(target.pathname)}`)), `Broken internal link: ${path} -> ${href}`);
    if (targetHtml && target.hash) {
      const id = decodeURIComponent(target.hash.slice(1));
      assert(targetHtml.includes(`id="${id}"`), `Missing anchor: ${path} -> ${href}`);
    }
    checkedLinks++;
  }
}
const robots = readFileSync(resolve(output, "robots.txt"), "utf8");
assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`), "robots.txt must reference the canonical sitemap");
console.log(`SEO export verified: ${pages.size} canonical pages, unique titles/descriptions, indexable metadata, valid JSON-LD, ${checkedLinks} internal links and anchors.`);
