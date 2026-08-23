import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputDirectory = path.resolve(process.cwd(), "out");
const homeDocument = path.join(outputDirectory, "index.html");
const initialJavaScriptGzipBudget = 360_000;
const homeDocumentGzipBudget = 75_000;

if (!fs.existsSync(homeDocument)) {
  throw new Error("Landing output is missing. Run next build before checking the performance budget.");
}

const document = fs.readFileSync(homeDocument, "utf8");
const scriptSources = [...document.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((source) => source.startsWith("/_next/"));
const uniqueSources = [...new Set(scriptSources)];

let initialJavaScriptGzipBytes = 0;
for (const source of uniqueSources) {
  const assetPath = path.resolve(outputDirectory, `.${source}`);
  if (!assetPath.startsWith(`${outputDirectory}${path.sep}`) || !fs.existsSync(assetPath)) {
    throw new Error(`Referenced initial JavaScript asset is missing: ${source}`);
  }
  initialJavaScriptGzipBytes += gzipSync(fs.readFileSync(assetPath)).byteLength;
}

const homeDocumentGzipBytes = gzipSync(document).byteLength;
const report = {
  initialJavaScriptGzipBytes,
  initialJavaScriptGzipBudget,
  homeDocumentGzipBytes,
  homeDocumentGzipBudget,
  initialScriptCount: uniqueSources.length,
};

console.log(`[landing-performance] ${JSON.stringify(report)}`);

if (initialJavaScriptGzipBytes > initialJavaScriptGzipBudget) {
  throw new Error(`Initial JavaScript gzip budget exceeded: ${initialJavaScriptGzipBytes} > ${initialJavaScriptGzipBudget}`);
}
if (homeDocumentGzipBytes > homeDocumentGzipBudget) {
  throw new Error(`Home document gzip budget exceeded: ${homeDocumentGzipBytes} > ${homeDocumentGzipBudget}`);
}
