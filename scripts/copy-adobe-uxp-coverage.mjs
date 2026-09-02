import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resources = [
  "adobe-uxp-coverage.json",
  "adobe-api-inventory.json",
  "adobe-beta-aaf-export-options-drift.json",
  "adobe-beta-project-options-drift.json",
  "adobe-beta-transition-options-drift.json",
  "adobe-beta-rectf-drift.json",
  "adobe-beta-color-drift.json",
  "adobe-beta-pointf-drift.json",
  "adobe-beta-c2pa-drift.json",
  "adobe-beta-media-drift.json",
  "adobe-beta-media-manager-drift.json",
  "adobe-beta-transcript-drift.json",
  "adobe-beta-work-area-drift.json",
  "uxp-js-coverage.json",
  "uxp-js-api-inventory.json",
  "premiere-doc-inventory.json",
  "cep-reference-inventory.json",
  "extendscript-api-inventory.json",
  "premiere-surface-registry.json",
];
const targetDirectory = resolve(scriptDirectory, "../dist/resources");

await mkdir(targetDirectory, { recursive: true });
await Promise.all(resources.map((resource) => copyFile(
  resolve(scriptDirectory, `../src/resources/${resource}`),
  resolve(targetDirectory, resource),
)));
