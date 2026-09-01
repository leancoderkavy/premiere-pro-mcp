import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resources = [
  "adobe-uxp-coverage.json",
  "adobe-api-inventory.json",
  "uxp-js-coverage.json",
  "uxp-js-api-inventory.json",
  "premiere-doc-inventory.json",
  "premiere-surface-registry.json",
];
const targetDirectory = resolve(scriptDirectory, "../dist/resources");

await mkdir(targetDirectory, { recursive: true });
await Promise.all(resources.map((resource) => copyFile(
  resolve(scriptDirectory, `../src/resources/${resource}`),
  resolve(targetDirectory, resource),
)));
