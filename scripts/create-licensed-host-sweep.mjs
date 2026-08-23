import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs", "licensed-host-sweep.matrix.json"), "utf8"));

const options = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
  if (argument === "--help") {
    console.log(`Usage: node scripts/create-licensed-host-sweep.mjs --host-os <Windows|macOS> --premiere-version <version> --panel-build <hash> --fixture-revision <safe-id> --fixture-sha256 <sha256> [--source-commit <sha>] [--case <id>]... [--output <path>]\n\nThis creates a redacted, not-run report skeleton. It does not start Premiere, call MCP tools, or inspect a project.`);
    process.exit(0);
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
  index += 1;
  const values = options.get(argument) ?? [];
  values.push(value);
  options.set(argument, values);
}

function one(name) {
  const values = options.get(name) ?? [];
  if (values.length !== 1) throw new Error(`${name} must be supplied exactly once`);
  return values[0];
}

function matches(name, value, expression) {
  if (!expression.test(value)) throw new Error(`${name} has an unsafe or invalid format`);
  return value;
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

const hostOs = one("--host-os");
if (!new Set(["Windows", "macOS"]).has(hostOs)) throw new Error("--host-os must be Windows or macOS");
const premiereVersion = matches("--premiere-version", one("--premiere-version"), /^[0-9][0-9A-Za-z._-]{0,63}$/);
const panelBuild = matches("--panel-build", one("--panel-build"), /^[0-9a-f]{7,64}$/i);
const fixtureRevision = matches("--fixture-revision", one("--fixture-revision"), /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const fixtureSha = matches("--fixture-sha256", one("--fixture-sha256"), /^[0-9a-f]{64}$/i);
const sourceCommit = matches("--source-commit", (options.get("--source-commit") ?? [currentCommit()])[0], /^[0-9a-f]{40}$/i);
const requestedCases = options.get("--case") ?? matrix.cases.map((entry) => entry.id);
const casesById = new Map(matrix.cases.map((entry) => [entry.id, entry]));
const unknown = requestedCases.filter((id) => !casesById.has(id));
if (unknown.length > 0) throw new Error(`Unknown sweep case: ${unknown.join(", ")}`);

const report = {
  schemaVersion: "premiere-pro-mcp.licensed-host-sweep.v1",
  sourceCommit: sourceCommit.toLowerCase(),
  host: { os: hostOs, premiereVersion, panelBuild: panelBuild.toLowerCase() },
  fixture: { revision: fixtureRevision, sha256: fixtureSha.toLowerCase() },
  sweep: { matrixId: matrix.id, matrixVersion: "1" },
  cases: requestedCases.map((id) => ({
    id,
    operationClass: casesById.get(id).operationClass,
    status: "not_run",
    evidence: [],
    undoEvidence: false,
  })),
};

const output = options.get("--output");
if (output) {
  const outputPath = path.resolve(one("--output"));
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ schemaVersion: report.schemaVersion, sourceCommit: report.sourceCommit, cases: report.cases.map((entry) => entry.id) }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
