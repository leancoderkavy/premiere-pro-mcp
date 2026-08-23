import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "project-intake-host-report/v1";
const NOT_RUN_SHA256 = "0".repeat(64);
const NOT_RUN_COMMIT = "0".repeat(40);
const ALLOWED_STATUSES = new Set(["passed", "failed", "unsupported", "not_run"]);
const CASE_REQUIREMENTS = {
  "PIP-CONNECT-001": {
    tool: "verify_premiere_connection",
    evidence: ["structured_connection_response"],
    assertions: { overall: "ready" },
  },
  "PIP-PREVIEW-001": {
    tool: "preview_project_intake",
    evidence: ["structured_preview_response"],
    assertions: {
      applied: false,
      pathDisclosure: "redacted",
      organizationPlanApplied: false,
    },
  },
  "PIP-NO-MUTATION-001": {
    tool: "preview_project_intake",
    evidence: ["before_project_panel", "after_project_panel", "structured_preview_response"],
    assertions: {
      projectMutated: false,
      projectSaved: false,
    },
  },
};
const SENSITIVE_CONTENT = /(?:(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|\\\\|file:\/\/|\/(?:Users|home|private)\/|authorization|bearer\s+[A-Za-z0-9._-]+|api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|project(?:Name|Path)|media(?:Name|Path)|transcript|prompt)/i;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${label} contains unsupported field: ${key}`);
  }
  return true;
}

function isNonEmptyString(value, maxLength = 128) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(value ?? "");
}

function isCommit(value) {
  return /^[0-9a-f]{40}$/i.test(value ?? "");
}

function isRfc3339(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value);
}

function serializedValues(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(serializedValues).join("\n");
  if (isObject(value)) return Object.values(value).map(serializedValues).join("\n");
  return "";
}

function validateEvidence(evidence, label, errors) {
  if (!Array.isArray(evidence)) {
    errors.push(`${label}.evidence must be an array`);
    return [];
  }

  const kinds = [];
  for (const [index, item] of evidence.entries()) {
    const evidenceLabel = `${label}.evidence[${index}]`;
    hasOnlyKeys(item, new Set(["kind", "reference", "sha256"]), evidenceLabel, errors);
    if (!isNonEmptyString(item?.kind, 64)) errors.push(`${evidenceLabel}.kind is required`);
    else kinds.push(item.kind);
    if (typeof item?.reference !== "string" || !/^evidence:\/\/[a-z0-9][a-z0-9._-]{0,127}$/i.test(item.reference)) {
      errors.push(`${evidenceLabel}.reference must be an opaque evidence:// reference`);
    }
    if (!isSha256(item?.sha256)) errors.push(`${evidenceLabel}.sha256 must be a SHA-256 hash`);
  }
  if (new Set(kinds).size !== kinds.length) errors.push(`${label}.evidence must not repeat a kind`);
  return kinds;
}

function validatePassedCase(entry, requirement, errors) {
  const label = `case ${entry.id}`;
  if (!isRfc3339(entry.executedAt)) errors.push(`${label}.executedAt must be an RFC 3339 timestamp`);
  hasOnlyKeys(entry.assertions, new Set(["tool", ...Object.keys(requirement.assertions)]), `${label}.assertions`, errors);
  if (entry.assertions?.tool !== requirement.tool) errors.push(`${label}.assertions.tool must be ${requirement.tool}`);
  for (const [key, expected] of Object.entries(requirement.assertions)) {
    if (entry.assertions?.[key] !== expected) errors.push(`${label}.assertions.${key} must be ${JSON.stringify(expected)}`);
  }

  const evidenceKinds = validateEvidence(entry.evidence, label, errors);
  for (const requiredKind of requirement.evidence) {
    if (!evidenceKinds.includes(requiredKind)) errors.push(`${label} requires ${requiredKind} evidence`);
  }
  for (const kind of evidenceKinds) {
    if (!requirement.evidence.includes(kind)) errors.push(`${label} has unsupported evidence kind: ${kind}`);
  }
}

function validateReport(report) {
  const errors = [];
  hasOnlyKeys(report, new Set(["schemaVersion", "sourceCommit", "host", "client", "fixture", "privacy", "cases"]), "report", errors);
  if (report?.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!isCommit(report?.sourceCommit)) errors.push("sourceCommit must be a 40-character commit SHA");

  hasOnlyKeys(report?.host, new Set(["os", "premiereVersion", "premiereBuild", "connector"]), "host", errors);
  if (!new Set(["Windows", "macOS"]).has(report?.host?.os)) errors.push("host.os must be Windows or macOS");
  if (!isNonEmptyString(report?.host?.premiereVersion, 64)) errors.push("host.premiereVersion is required");
  if (!isNonEmptyString(report?.host?.premiereBuild, 64)) errors.push("host.premiereBuild is required");
  hasOnlyKeys(report?.host?.connector, new Set(["type", "buildHash"]), "host.connector", errors);
  if (report?.host?.connector?.type !== "cep") errors.push("host.connector.type must be cep for v1.13.0 Project Intake validation");
  if (!/^[0-9a-f]{7,64}$/i.test(report?.host?.connector?.buildHash ?? "")) errors.push("host.connector.buildHash must be a build hash");

  hasOnlyKeys(report?.client, new Set(["name", "version"]), "client", errors);
  if (!isNonEmptyString(report?.client?.name)) errors.push("client.name is required");
  if (!isNonEmptyString(report?.client?.version)) errors.push("client.version is required");

  hasOnlyKeys(report?.fixture, new Set(["revision", "sha256"]), "fixture", errors);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(report?.fixture?.revision ?? "")) errors.push("fixture.revision must be a non-sensitive identifier");
  if (!isSha256(report?.fixture?.sha256)) errors.push("fixture.sha256 must be a SHA-256 hash");

  const requiredPrivacyFlags = ["containsOnlyGeneratedFixtureData", "localPathsRemoved", "mediaNamesRemoved", "promptsRemoved", "transcriptsRemoved", "credentialsRemoved"];
  hasOnlyKeys(report?.privacy, new Set(requiredPrivacyFlags), "privacy", errors);
  for (const flag of requiredPrivacyFlags) {
    if (report?.privacy?.[flag] !== true) errors.push(`privacy.${flag} must be true`);
  }

  if (!Array.isArray(report?.cases) || report.cases.length !== Object.keys(CASE_REQUIREMENTS).length) {
    errors.push(`cases must contain exactly ${Object.keys(CASE_REQUIREMENTS).length} Project Intake cases`);
  }

  const seenCaseIds = new Set();
  for (const entry of report?.cases ?? []) {
    const label = `case ${entry?.id ?? "<unknown>"}`;
    hasOnlyKeys(entry, new Set(["id", "status", "executedAt", "assertions", "evidence"]), label, errors);
    if (!Object.hasOwn(CASE_REQUIREMENTS, entry?.id)) errors.push(`${label} is not a supported Project Intake case`);
    if (seenCaseIds.has(entry?.id)) errors.push(`${label} is duplicated`);
    seenCaseIds.add(entry?.id);
    if (!ALLOWED_STATUSES.has(entry?.status)) errors.push(`${label} has an invalid status`);

    if (entry?.status === "passed" && CASE_REQUIREMENTS[entry.id]) {
      validatePassedCase(entry, CASE_REQUIREMENTS[entry.id], errors);
    } else {
      if (entry?.executedAt !== undefined) errors.push(`${label}.executedAt is only recorded for passed cases`);
      if (entry?.assertions !== undefined) errors.push(`${label}.assertions are only accepted for passed cases`);
      const evidenceKinds = validateEvidence(entry?.evidence, label, errors);
      if (evidenceKinds.length > 0) errors.push(`${label} must not include evidence unless it passed; retain failure evidence outside this minimal shared report`);
    }
  }
  for (const id of Object.keys(CASE_REQUIREMENTS)) {
    if (!seenCaseIds.has(id)) errors.push(`cases must include ${id}`);
  }

  const previewCase = report?.cases?.find((entry) => entry?.id === "PIP-PREVIEW-001");
  const noMutationCase = report?.cases?.find((entry) => entry?.id === "PIP-NO-MUTATION-001");
  if (previewCase?.status === "passed" && noMutationCase?.status !== "passed") {
    errors.push("PIP-PREVIEW-001 cannot pass unless PIP-NO-MUTATION-001 also passes");
  }
  if (report?.cases?.some((entry) => entry?.status === "passed")) {
    if (report.sourceCommit === NOT_RUN_COMMIT) errors.push("passed cases require a real sourceCommit, not the template sentinel");
    if (report.fixture?.sha256 === NOT_RUN_SHA256) errors.push("passed cases require a real fixture checksum, not the template sentinel");
  }

  if (SENSITIVE_CONTENT.test(serializedValues(report))) {
    errors.push("report appears to contain project data, a local path, or credential-like content; redact it before sharing");
  }

  return errors;
}

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error("Usage: node scripts/validate-project-intake-host-report.mjs <redacted-report.json>");
}

const resolvedPath = path.resolve(reportPath);
let report;
try {
  report = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
} catch (error) {
  throw new Error(`Unable to parse Project Intake host report: ${error instanceof Error ? error.message : String(error)}`);
}

const errors = validateReport(report);
if (errors.length > 0) {
  throw new Error(`Project Intake host report is invalid:\n- ${errors.join("\n- ")}`);
}

console.log(JSON.stringify({
  report: path.basename(resolvedPath),
  schemaVersion: SCHEMA_VERSION,
  sourceCommit: report.sourceCommit,
  host: report.host,
  totals: Object.fromEntries([...ALLOWED_STATUSES].map((status) => [
    status,
    report.cases.filter((entry) => entry.status === status).length,
  ])),
  humanReviewRequired: true,
  licensedHostVerifiedByValidator: false,
}, null, 2));
