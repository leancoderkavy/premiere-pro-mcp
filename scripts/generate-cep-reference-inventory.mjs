import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sources = [
  {
    repository: "Adobe-CEP/CEP-Resources",
    commit: "ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6",
    prefix: "",
    authority: "adobe",
    scope: "cep-platform",
  },
  {
    repository: "Adobe-CEP/Samples",
    commit: "e4946b73ac1e566dced8e95dba10811c31036927",
    prefix: "PProPanel/",
    authority: "adobe",
    scope: "premiere-extendscript-sample",
  },
  {
    repository: "docsforadobe/premiere-scripting-guide",
    commit: "4253cea094e84d43590b77012b33bd1c140f72ea",
    prefix: "",
    authority: "community",
    scope: "premiere-extendscript-guide",
  },
];
const outputPath = resolve(process.env.CEP_INVENTORY_OUTPUT_PATH ?? "src/resources/cep-reference-inventory.json");
const check = process.argv.includes("--check");

function category(source, path) {
  const lower = path.toLowerCase();
  if (source.scope === "premiere-extendscript-sample") return "sample";
  if (source.scope === "premiere-extendscript-guide") {
    if (lower.endsWith(".md")) return "documentation";
    if (lower.includes("mkdocs") || lower.endsWith(".py") || lower.endsWith(".yml")) return "documentation-tooling";
    return "site-asset";
  }
  if (lower.includes("zxpsigncmd")) return "signing-tool";
  if (lower.includes("csinterface")) return "cep-runtime-library";
  if (lower.includes("documentation") || lower.endsWith(".md") || lower.endsWith(".pdf")) return "documentation";
  if (lower.includes("sample") || lower.includes("demo")) return "sample";
  if (/\.(js|jsx|ts|tsx|c|cc|cpp|cxx|h|hpp|java|cs)$/.test(lower)) return "source";
  if (/\.(json|xml|plist|yml|yaml|toml|ini|conf)$/.test(lower)) return "configuration";
  return "asset";
}

async function repositoryTree(source) {
  const fixtureDirectory = process.env.CEP_INVENTORY_FIXTURE_DIRECTORY;
  if (fixtureDirectory) {
    const name = source.repository.replaceAll("/", "__");
    return JSON.parse(await readFile(resolve(fixtureDirectory, `${name}.json`), "utf8"));
  }
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "premiere-pro-mcp-inventory" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(
    `https://api.github.com/repos/${source.repository}/git/trees/${source.commit}?recursive=1`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`GitHub tree request failed for ${source.repository}: HTTP ${response.status}`);
  return response.json();
}

const entries = [];
for (const source of sources) {
  const tree = await repositoryTree(source);
  if (tree.truncated) throw new Error(`GitHub returned a truncated tree for ${source.repository}`);
  if (!Array.isArray(tree.tree)) throw new Error(`GitHub returned no tree for ${source.repository}`);
  const files = tree.tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(source.prefix));
  if (files.length === 0) throw new Error(`No files matched ${source.repository}:${source.prefix}`);
  for (const file of files) {
    if (!/^[0-9a-f]{40}$/.test(file.sha) || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Invalid Git blob metadata for ${source.repository}:${file.path}`);
    }
    entries.push({
      repository: source.repository,
      commit: source.commit,
      authority: source.authority,
      scope: source.scope,
      path: file.path,
      blobSha: file.sha,
      size: file.size,
      category: category(source, file.path),
    });
  }
}
entries.sort((left, right) => `${left.repository}/${left.path}`.localeCompare(`${right.repository}/${right.path}`));
const keys = entries.map((entry) => `${entry.repository}:${entry.path}`);
if (new Set(keys).size !== keys.length) throw new Error("CEP reference inventory contains duplicate repository paths");
const counts = Object.fromEntries(sources.map((source) => [
  source.repository,
  entries.filter((entry) => entry.repository === source.repository).length,
]));
const inventory = {
  schemaVersion: 1,
  generatedFrom: "Pinned recursive Git trees; Adobe authority and community reference remain distinct.",
  sources: sources.map(({ prefix, ...source }) => ({ ...source, pathPrefix: prefix })),
  stats: { total: entries.length, byRepository: counts },
  entries,
};
const rendered = `${JSON.stringify(inventory, null, 2)}\n`;
if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current.replaceAll("\r\n", "\n") !== rendered) {
    console.error("CEP reference inventory is stale. Run npm run cep:reference-inventory.");
    process.exitCode = 1;
  } else {
    console.log(`CEP reference inventory is current: ${entries.length} files.`);
  }
} else {
  await writeFile(outputPath, rendered);
  console.log(`Wrote ${entries.length} CEP and Premiere scripting reference files.`);
}
