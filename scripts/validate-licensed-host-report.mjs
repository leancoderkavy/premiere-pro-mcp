import fs from "node:fs";
import path from "node:path";

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error("Usage: node scripts/validate-licensed-host-report.mjs <redacted-report.json>");
}

const resolvedPath = path.resolve(reportPath);
const report = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
const errors = [];
const allowedStatuses = new Set(["passed", "failed", "unsupported", "not_run"]);

if (!/^[0-9a-f]{40}$/i.test(report.sourceCommit ?? "")) errors.push("sourceCommit must be a 40-character commit SHA");
if (!new Set(["Windows", "macOS"]).has(report.host?.os)) errors.push("host.os must be Windows or macOS");
if (typeof report.host?.premiereVersion !== "string" || !report.host.premiereVersion.trim()) errors.push("host.premiereVersion is required");
if (!/^[0-9a-f]{7,64}$/i.test(report.host?.panelBuild ?? "")) errors.push("host.panelBuild must be a build hash");
if (typeof report.fixture?.revision !== "string" || !report.fixture.revision.trim()) errors.push("fixture.revision is required");
if (!/^[0-9a-f]{64}$/i.test(report.fixture?.sha256 ?? "")) errors.push("fixture.sha256 must be a SHA-256 hash");
if (!Array.isArray(report.cases) || report.cases.length === 0) errors.push("cases must be a non-empty array");

const seenCaseIds = new Set();
for (const entry of report.cases ?? []) {
  if (typeof entry?.id !== "string" || !entry.id.trim()) errors.push("each case requires an id");
  else if (seenCaseIds.has(entry.id)) errors.push(`case id is duplicated: ${entry.id}`);
  else seenCaseIds.add(entry.id);

  if (!allowedStatuses.has(entry?.status)) errors.push(`case ${entry?.id ?? "<unknown>"} has an invalid status`);
  if (!Array.isArray(entry?.evidence)) errors.push(`case ${entry?.id ?? "<unknown>"} requires an evidence array`);
  if (entry?.status === "passed") {
    if (entry.evidence.length < 3) errors.push(`passed case ${entry.id} requires before, after, and structured-response evidence`);
    if (entry.undoEvidence !== true) errors.push(`passed case ${entry.id} requires undoEvidence: true`);
  }
}

const serialized = JSON.stringify(report);
if (/([A-Za-z]:\\|\/Users\/|\/home\/|authorization|bearer\s+[A-Za-z0-9._-]+)/i.test(serialized)) {
  errors.push("report appears to include a local path or credential-like value; redact it before sharing");
}

if (errors.length > 0) {
  throw new Error(`Licensed-host report is invalid:\n- ${errors.join("\n- ")}`);
}

const summary = {
  report: path.basename(resolvedPath),
  sourceCommit: report.sourceCommit,
  host: report.host,
  totals: Object.fromEntries([...allowedStatuses].map((status) => [
    status,
    report.cases.filter((entry) => entry.status === status).length,
  ])),
};
console.log(JSON.stringify(summary, null, 2));
