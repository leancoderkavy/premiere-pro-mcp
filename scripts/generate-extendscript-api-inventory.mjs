import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repository = "docsforadobe/premiere-scripting-guide";
const commit = "4253cea094e84d43590b77012b33bd1c140f72ea";
const referencePath = resolve(process.env.EXTENDSCRIPT_REFERENCE_PATH ?? "src/resources/cep-reference-inventory.json");
const outputPath = resolve(process.env.EXTENDSCRIPT_INVENTORY_OUTPUT_PATH ?? "src/resources/extendscript-api-inventory.json");
const fixtureDirectory = process.env.EXTENDSCRIPT_INVENTORY_FIXTURE_DIRECTORY;
const check = process.argv.includes("--check");

async function markdown(path) {
  if (fixtureDirectory) return readFile(resolve(fixtureDirectory, path), "utf8");
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Guide request failed for ${path}: HTTP ${response.status}`);
  return response.text();
}

function parsePage(path, source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const title = lines.find((line) => line.startsWith("# "))?.slice(2).trim();
  if (!title || !/ object$/i.test(title)) return [];
  const objectName = title.replace(/ object$/i, "");
  let section = null;
  let sectionHasHeadings = false;
  const symbols = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "## Attributes") { section = "attribute"; sectionHasHeadings = false; }
    else if (line === "## Methods") { section = "method"; sectionHasHeadings = false; }
    else if (line.startsWith("## ")) section = null;
    if (section && !sectionHasHeadings) {
      const tableMember = line.match(/^\|\s*`([^`]+)`\s*\|/);
      if (tableMember) {
        const member = tableMember[1];
        symbols.push({
          object: objectName,
          name: `${objectName}.${member}`,
          kind: section,
          signature: member,
          sourcePath: path,
        });
        continue;
      }
    }
    if (!section || !line.startsWith("### ")) continue;
    sectionHasHeadings = true;
    const name = line.slice(4).trim();
    const signatureLine = lines.slice(index + 1).find((candidate) => candidate.trim() !== "");
    const match = signatureLine?.match(/^`([^`]+)`$/);
    if (!match) throw new Error(`Missing inline signature for ${path}:${name}`);
    symbols.push({ object: objectName, name, kind: section, signature: match[1], sourcePath: path });
  }
  return symbols;
}

const reference = JSON.parse(await readFile(referencePath, "utf8"));
const paths = reference.entries
  .filter((entry) => entry.repository === repository && entry.path.startsWith("docs/") && entry.path.endsWith(".md"))
  .map((entry) => entry.path)
  .sort();
if (paths.length === 0) throw new Error("Pinned CEP reference inventory contains no scripting guide Markdown files");
const symbols = [];
for (const path of paths) symbols.push(...parsePage(path, await markdown(path)));
symbols.sort((left, right) => `${left.object}:${left.kind}:${left.name}`.localeCompare(`${right.object}:${right.kind}:${right.name}`));
if (symbols.length === 0) throw new Error("No ExtendScript symbols were parsed from the guide");
const keys = symbols.map((symbol) => `${symbol.object}:${symbol.kind}:${symbol.name}`);
if (new Set(keys).size !== keys.length) throw new Error("ExtendScript inventory contains duplicate object members");
const objects = [...new Set(symbols.map((symbol) => symbol.object))].sort();
const inventory = {
  schemaVersion: 1,
  source: { repository, commit, authority: "community", authorityNote: "Community-maintained guide; not Adobe API authority." },
  stats: {
    total: symbols.length,
    objects: objects.length,
    attributes: symbols.filter((symbol) => symbol.kind === "attribute").length,
    methods: symbols.filter((symbol) => symbol.kind === "method").length,
  },
  objects,
  symbols,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;
if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("ExtendScript API inventory is stale. Run npm run extendscript:api-inventory.");
    process.exitCode = 1;
  } else console.log(`ExtendScript API inventory is current: ${symbols.length} symbols.`);
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${symbols.length} ExtendScript symbols across ${objects.length} objects.`);
}
