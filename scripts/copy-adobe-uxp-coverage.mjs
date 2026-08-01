import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const source = resolve(scriptDirectory, "../src/resources/adobe-uxp-coverage.json");
const target = resolve(scriptDirectory, "../dist/resources/adobe-uxp-coverage.json");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
