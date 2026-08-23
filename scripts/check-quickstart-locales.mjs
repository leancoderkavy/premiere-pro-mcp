import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const quickstartDir = path.join(root, "docs", "quickstart");
const localeManifest = JSON.parse(fs.readFileSync(path.join(quickstartDir, "locales.json"), "utf8"));

function sectionIds(file) {
  const source = fs.readFileSync(file, "utf8");
  const ids = [...source.matchAll(/<!-- quickstart:section=([a-z0-9-]+) -->/g)].map((match) => match[1]);
  if (ids.length === 0) throw new Error(`${path.basename(file)} has no quick-start section markers`);
  if (new Set(ids).size !== ids.length) throw new Error(`${path.basename(file)} has duplicate quick-start section markers`);
  return ids;
}

if (localeManifest.schemaVersion !== "premiere-pro-mcp.quickstart-locales.v1") {
  throw new Error("Unsupported quick-start locale manifest schema");
}
const sourceIds = sectionIds(path.join(quickstartDir, localeManifest.source));
for (const locale of localeManifest.locales ?? []) {
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale.code ?? "")) throw new Error("Locale codes must be stable BCP 47-style identifiers");
  if (typeof locale.file !== "string" || !/^[a-z-]+\.md$/.test(locale.file)) throw new Error(`Locale ${locale.code} has an unsafe file name`);
  if (typeof locale.reviewStatus !== "string" || !locale.reviewStatus.includes("machine-assisted")) {
    throw new Error(`Locale ${locale.code} must disclose its machine-assisted review status`);
  }
  const translatedIds = sectionIds(path.join(quickstartDir, locale.file));
  if (JSON.stringify(translatedIds) !== JSON.stringify(sourceIds)) {
    throw new Error(`${locale.file} does not match the English source section structure`);
  }
}

console.log(`Quick-start locales verified: ${localeManifest.locales.length} translations match ${localeManifest.source}`);
