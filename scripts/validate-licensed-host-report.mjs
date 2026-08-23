import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs", "licensed-host-sweep.matrix.json"), "utf8"));
const sweepCasesById = new Map(matrix.cases.map((entry) => [entry.id, entry]));
const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error("Usage: node scripts/validate-licensed-host-report.mjs <redacted-report.json>");
}

const resolvedPath = path.resolve(reportPath);
const parsedReport = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
const report = parsedReport && typeof parsedReport === "object" && !Array.isArray(parsedReport) ? parsedReport : {};
const errors = [];
const allowedStatuses = new Set(["passed", "failed", "unsupported", "not_run"]);
const allowedEvidenceKinds = new Set([
  "host_state",
  "panel_state",
  "before_state",
  "after_state",
  "structured_response",
  "undo",
  "artifact_check",
]);
const isSweep = report.schemaVersion === "premiere-pro-mcp.licensed-host-sweep.v1";
const cases = Array.isArray(report.cases) ? report.cases : [];

function hasOnlyKeys(value, expectedKeys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys);
}

if (report.schemaVersion !== undefined && !isSweep) {
  errors.push("schemaVersion must be premiere-pro-mcp.licensed-host-sweep.v1 when supplied");
}
if (!/^[0-9a-f]{40}$/i.test(report.sourceCommit ?? "")) errors.push("sourceCommit must be a 40-character commit SHA");
if (!new Set(["Windows", "macOS"]).has(report.host?.os)) errors.push("host.os must be Windows or macOS");
if (typeof report.host?.premiereVersion !== "string" || !report.host.premiereVersion.trim()) errors.push("host.premiereVersion is required");
if (!/^[0-9a-f]{7,64}$/i.test(report.host?.panelBuild ?? "")) errors.push("host.panelBuild must be a build hash");
if (typeof report.fixture?.revision !== "string" || !report.fixture.revision.trim()) errors.push("fixture.revision is required");
if (!/^[0-9a-f]{64}$/i.test(report.fixture?.sha256 ?? "")) errors.push("fixture.sha256 must be a SHA-256 hash");
if (!Array.isArray(report.cases) || report.cases.length === 0) errors.push("cases must be a non-empty array");

if (isSweep) {
  const reportKeys = Object.keys(report).sort();
  const expectedKeys = ["cases", "fixture", "host", "schemaVersion", "sourceCommit", "sweep"];
  if (JSON.stringify(reportKeys) !== JSON.stringify(expectedKeys)) errors.push("sweep reports must not add unstructured fields");
  if (!hasOnlyKeys(report.host, ["os", "panelBuild", "premiereVersion"])) {
    errors.push("sweep host must contain only os, premiereVersion, and panelBuild");
  }
  if (!hasOnlyKeys(report.fixture, ["revision", "sha256"])) {
    errors.push("sweep fixture must contain only revision and sha256");
  }
  if (!hasOnlyKeys(report.sweep, ["matrixId", "matrixVersion"])) {
    errors.push("sweep must contain only matrixId and matrixVersion");
  }
  if (report.sweep?.matrixId !== matrix.id || report.sweep?.matrixVersion !== "1") {
    errors.push("sweep must identify the checked-in core-connection-and-edit-v1 matrix version 1");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(report.fixture?.revision ?? "")) {
    errors.push("sweep fixture.revision must be a non-sensitive identifier");
  }
}

const seenCaseIds = new Set();
for (const entry of cases) {
  if (typeof entry?.id !== "string" || !entry.id.trim()) errors.push("each case requires an id");
  else if (seenCaseIds.has(entry.id)) errors.push(`case id is duplicated: ${entry.id}`);
  else seenCaseIds.add(entry.id);

  if (!allowedStatuses.has(entry?.status)) errors.push(`case ${entry?.id ?? "<unknown>"} has an invalid status`);
  if (!Array.isArray(entry?.evidence)) errors.push(`case ${entry?.id ?? "<unknown>"} requires an evidence array`);

  if (isSweep) {
    const matrixCase = sweepCasesById.get(entry?.id);
    if (!matrixCase) errors.push(`case ${entry?.id ?? "<unknown>"} is not in the checked-in sweep matrix`);
    if (!new Set(["read_only", "mutation"]).has(entry?.operationClass)) {
      errors.push(`case ${entry?.id ?? "<unknown>"} must identify its operationClass`);
    } else if (matrixCase && entry.operationClass !== matrixCase.operationClass) {
      errors.push(`case ${entry.id} operationClass does not match the sweep matrix`);
    }
    const caseKeys = Object.keys(entry ?? {}).sort();
    const expectedCaseKeys = ["evidence", "id", "operationClass", "status", "undoEvidence"];
    if (JSON.stringify(caseKeys) !== JSON.stringify(expectedCaseKeys)) errors.push(`case ${entry?.id ?? "<unknown>"} must not add raw response or path fields`);
    for (const evidence of entry?.evidence ?? []) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
        errors.push(`case ${entry?.id ?? "<unknown>"} evidence must use { kind, ref } references`);
        continue;
      }
      if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(["kind", "ref"])) {
        errors.push(`case ${entry?.id ?? "<unknown>"} evidence must contain only kind and ref`);
      }
      if (!allowedEvidenceKinds.has(evidence.kind)) errors.push(`case ${entry?.id ?? "<unknown>"} has invalid evidence kind`);
      if (typeof evidence.ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(evidence.ref)) {
        errors.push(`case ${entry?.id ?? "<unknown>"} evidence refs must be opaque non-sensitive IDs`);
      }
    }
  }

  if (entry?.status === "passed") {
    if (isSweep && entry.operationClass === "read_only") {
      const kinds = new Set((entry.evidence ?? []).map((evidence) => evidence?.kind));
      for (const kind of sweepCasesById.get(entry.id)?.requiredEvidenceKinds ?? []) {
        if (!kinds.has(kind)) errors.push(`passed read-only case ${entry.id} requires ${kind} evidence`);
      }
      if (entry.undoEvidence !== false) errors.push(`passed read-only case ${entry.id} must not claim undo evidence`);
    } else {
      if (entry.evidence.length < 3) errors.push(`passed case ${entry.id} requires before, after, and structured-response evidence`);
      if (entry.undoEvidence !== true) errors.push(`passed case ${entry.id} requires undoEvidence: true`);
      if (isSweep) {
        const kinds = new Set((entry.evidence ?? []).map((evidence) => evidence?.kind));
        for (const kind of sweepCasesById.get(entry.id)?.requiredEvidenceKinds ?? []) {
          if (!kinds.has(kind)) errors.push(`passed mutation case ${entry.id} requires ${kind} evidence`);
        }
      }
    }
  }
}

const serialized = JSON.stringify(report);
if (/([A-Za-z]:\\|\/Users\/|\/home\/|\/private\/|authorization|bearer\s+[A-Za-z0-9._-]+|(?:token|password|secret|cookie)\s*[:=])/i.test(serialized)) {
  errors.push("report appears to include a local path or credential-like value; redact it before sharing");
}

if (errors.length > 0) {
  throw new Error(`Licensed-host report is invalid:\n- ${errors.join("\n- ")}`);
}

const summary = {
  report: path.basename(resolvedPath),
  schemaVersion: report.schemaVersion ?? "legacy-editorial-report",
  sourceCommit: report.sourceCommit,
  host: report.host,
  totals: Object.fromEntries([...allowedStatuses].map((status) => [
    status,
    cases.filter((entry) => entry.status === status).length,
  ])),
};
console.log(JSON.stringify(summary, null, 2));
