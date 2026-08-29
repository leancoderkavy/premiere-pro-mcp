import { createHash } from "node:crypto";

export const PROJECT_INTAKE_TEMPLATE_SCHEMA_VERSION = 1;
export const PROJECT_INTAKE_REPORT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_INTAKE_ITEMS = 2_000;
export const MAX_PROJECT_INTAKE_RULES = 64;
// A clip can produce six independent findings (extension, frame rate, offline,
// proxy, path, and ambiguous organization), plus bounded project-level findings.
export const MAX_PROJECT_INTAKE_FINDINGS = 12_200;
// Premiere's footage interpretation can expose a measured decimal that drifts
// slightly from the source timebase. Keep canonical rates distinct, then allow
// a bounded tolerance for non-canonical host readings.
export const FRAME_RATE_CANONICAL_SNAP_TOLERANCE_FPS = 0.005;
export const FRAME_RATE_MATCH_TOLERANCE_FPS = 0.05;

export type IntakeCertainty = "observed" | "unavailable" | "not_checked";
export type IntakeSeverity = "error" | "warning" | "info";
export type IntakeStatus = "ready" | "needs_attention" | "incomplete";

export interface RequiredBinRule {
  name: string;
  parentPath?: string;
}

export interface ApprovedPathPrefix {
  id: string;
  prefix: string;
}

export interface OrganizationMatchRule {
  filenamePrefixes?: string[];
  extensions?: string[];
}

export interface OrganizationRule {
  id: string;
  destinationBinName: string;
  match: OrganizationMatchRule;
  colorIndex?: number;
}

export interface FacilityIntakeTemplate {
  schemaVersion: typeof PROJECT_INTAKE_TEMPLATE_SCHEMA_VERSION;
  id: string;
  version: string;
  requiredBins: RequiredBinRule[];
  allowedExtensions: string[];
  allowedFrameRates: number[];
  proxyPolicy: "ignore" | "report_missing" | "require";
  approvedPathPrefixes: ApprovedPathPrefix[];
  requiredEvidence: Array<"extension" | "frame_rate" | "offline" | "proxy" | "path">;
  organizationRules: OrganizationRule[];
}

export interface ProjectIntakeItem {
  id: string;
  name: string;
  type: "clip" | "bin" | "sequence" | "other";
  parentId?: string;
  treePath?: string;
  mediaPath?: string;
  offline?: boolean;
  hasProxy?: boolean;
  frameRate?: number;
  /** Derived during snapshot validation; never accepted as caller authority. */
  frameRateUnsupported?: true;
}

export interface ProjectIntakeSnapshot {
  project: {
    id: string;
    name?: string;
  };
  items: ProjectIntakeItem[];
  truncated: boolean;
  unavailableEvidence: string[];
}

export interface ProjectIntakeFinding {
  code: string;
  severity: IntakeSeverity;
  certainty: IntakeCertainty;
  itemId?: string;
  expected?: Record<string, unknown>;
  observed?: Record<string, unknown>;
}

export interface ProjectIntakeOrganizationPlan {
  applied: false;
  planDigest: string;
  proposedBins: Array<{
    name: string;
    exists: boolean;
    createIfApproved: boolean;
  }>;
  proposedMoves: Array<{
    projectItemId: string;
    expectedParentId?: string;
    destinationBinName: string;
    ruleId: string;
    colorIndex?: number;
  }>;
}

export interface ProjectIntakeReport {
  schemaVersion: typeof PROJECT_INTAKE_REPORT_SCHEMA_VERSION;
  applied: false;
  status: IntakeStatus;
  project: {
    id: string;
    name?: string;
    revision: string;
  };
  template: {
    id: string;
    version: string;
    digest: string;
  };
  capture: {
    itemCount: number;
    truncated: boolean;
    pathDisclosure: "redacted" | "requested";
  };
  findings: ProjectIntakeFinding[];
  organizationPlan: ProjectIntakeOrganizationPlan;
  limitations: string[];
}

export interface BuildProjectIntakeOptions {
  includePaths?: boolean;
}

const REQUIRED_EVIDENCE = new Set(["extension", "frame_rate", "offline", "proxy", "path"]);
const ITEM_TYPES = new Set(["clip", "bin", "sequence", "other"]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return sha256(stableStringify(value));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`${label}.${key} is not supported`);
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxLength);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function boundedArray(value: unknown, label: string, maxItems: number): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > maxItems) throw new Error(`${label} must contain at most ${maxItems} entries`);
  return value;
}

function normalizeExtension(value: unknown, label: string): string {
  const extension = requiredText(value, label, 32).replace(/^\.+/, "").toLocaleLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) throw new Error(`${label} must be a simple file extension`);
  return extension;
}

function normalizeExtensions(value: unknown, label: string): string[] {
  const values = boundedArray(value, label, MAX_PROJECT_INTAKE_RULES);
  const normalized = values.map((entry, index) => normalizeExtension(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate extensions`);
  return normalized.sort();
}

function normalizePrefixes(value: unknown, label: string): string[] {
  const values = boundedArray(value, label, MAX_PROJECT_INTAKE_RULES);
  const normalized = values.map((entry, index) => requiredText(entry, `${label}[${index}]`, 255).toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate filename prefixes`);
  return normalized.sort();
}

function normalizeFrameRates(value: unknown, label: string): number[] {
  const values = boundedArray(value, label, MAX_PROJECT_INTAKE_RULES);
  const normalized = values.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 1 || entry > 240) {
      throw new Error(`${label}[${index}] must be a finite frame rate from 1 through 240`);
    }
    return Number(entry.toFixed(6));
  });
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate frame rates`);
  return normalized.sort((left, right) => left - right);
}

function normalizeTreePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/")
    .toLocaleLowerCase();
}

function normalizeFilesystemPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function fileExtension(item: ProjectIntakeItem): string | undefined {
  const source = item.mediaPath ?? item.name;
  const leaf = source.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const index = leaf.lastIndexOf(".");
  if (index <= 0 || index === leaf.length - 1) return undefined;
  const value = leaf.slice(index + 1).toLocaleLowerCase();
  return /^[a-z0-9]{1,16}$/.test(value) ? value : undefined;
}

function parentTreePath(item: ProjectIntakeItem): string | undefined {
  if (!item.treePath) return undefined;
  const path = normalizeTreePath(item.treePath);
  const parts = path.split("/");
  if (parts.at(-1) === item.name.trim().toLocaleLowerCase()) parts.pop();
  return parts.join("/") || undefined;
}

function pathEvidence(mediaPath: string, includePaths: boolean): Record<string, unknown> {
  return {
    mediaPathHash: sha256(normalizeFilesystemPath(mediaPath)),
    ...(includePaths ? { mediaPath } : {}),
  };
}

function isRequired(template: FacilityIntakeTemplate, evidence: "extension" | "frame_rate" | "offline" | "proxy" | "path"): boolean {
  return template.requiredEvidence.includes(evidence)
    || (evidence === "extension" && template.allowedExtensions.length > 0)
    || (evidence === "frame_rate" && template.allowedFrameRates.length > 0)
    || (evidence === "proxy" && template.proxyPolicy === "require")
    || (evidence === "path" && template.approvedPathPrefixes.length > 0);
}

const CANONICAL_FRAME_RATES = [
  23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120,
];

function canonicalFrameRate(value: number): number | undefined {
  return CANONICAL_FRAME_RATES.find((rate) =>
    Math.abs(rate - value) <= FRAME_RATE_CANONICAL_SNAP_TOLERANCE_FPS);
}

function frameRateMatches(observed: number, allowed: number): boolean {
  const observedCanonical = canonicalFrameRate(observed);
  const allowedCanonical = canonicalFrameRate(allowed);
  if (observedCanonical !== undefined || allowedCanonical !== undefined) {
    if (observedCanonical !== undefined && allowedCanonical !== undefined) {
      return observedCanonical === allowedCanonical;
    }
  }
  return Math.abs(allowed - observed) <= FRAME_RATE_MATCH_TOLERANCE_FPS;
}

function findingSort(left: ProjectIntakeFinding, right: ProjectIntakeFinding): number {
  const severity = { error: 0, warning: 1, info: 2 } as const;
  return severity[left.severity] - severity[right.severity]
    || left.code.localeCompare(right.code)
    || (left.itemId ?? "").localeCompare(right.itemId ?? "")
    || stableStringify(left.expected).localeCompare(stableStringify(right.expected));
}

function pushFinding(findings: ProjectIntakeFinding[], finding: ProjectIntakeFinding): void {
  if (findings.length >= MAX_PROJECT_INTAKE_FINDINGS) return;
  findings.push(finding);
}

export function validateFacilityIntakeTemplate(value: unknown): FacilityIntakeTemplate {
  const input = asRecord(value, "template");
  assertOnlyKeys(input, [
    "schemaVersion", "id", "version", "requiredBins", "allowedExtensions", "allowedFrameRates",
    "proxyPolicy", "approvedPathPrefixes", "requiredEvidence", "organizationRules",
  ], "template");
  if (input.schemaVersion !== PROJECT_INTAKE_TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`template.schemaVersion must be ${PROJECT_INTAKE_TEMPLATE_SCHEMA_VERSION}`);
  }

  const requiredBins = boundedArray(input.requiredBins, "template.requiredBins", MAX_PROJECT_INTAKE_RULES).map((entry, index) => {
    const rule = asRecord(entry, `template.requiredBins[${index}]`);
    assertOnlyKeys(rule, ["name", "parentPath"], `template.requiredBins[${index}]`);
    return {
      name: requiredText(rule.name, `template.requiredBins[${index}].name`, 255),
      ...(optionalText(rule.parentPath, `template.requiredBins[${index}].parentPath`, 1024) ? {
        parentPath: optionalText(rule.parentPath, `template.requiredBins[${index}].parentPath`, 1024),
      } : {}),
    };
  });
  const binKeys = requiredBins.map((rule) => `${normalizeTreePath(rule.parentPath ?? "")}\u0000${rule.name.toLocaleLowerCase()}`);
  if (new Set(binKeys).size !== binKeys.length) throw new Error("template.requiredBins contains duplicate bin requirements");

  const approvedPathPrefixes = boundedArray(input.approvedPathPrefixes, "template.approvedPathPrefixes", MAX_PROJECT_INTAKE_RULES).map((entry, index) => {
    const prefix = asRecord(entry, `template.approvedPathPrefixes[${index}]`);
    assertOnlyKeys(prefix, ["id", "prefix"], `template.approvedPathPrefixes[${index}]`);
    return {
      id: requiredText(prefix.id, `template.approvedPathPrefixes[${index}].id`, 128),
      prefix: requiredText(prefix.prefix, `template.approvedPathPrefixes[${index}].prefix`, 4096),
    };
  });
  if (new Set(approvedPathPrefixes.map((prefix) => prefix.id)).size !== approvedPathPrefixes.length) {
    throw new Error("template.approvedPathPrefixes contains duplicate ids");
  }

  const requiredEvidence = boundedArray(input.requiredEvidence, "template.requiredEvidence", 5).map((entry, index) => {
    if (typeof entry !== "string" || !REQUIRED_EVIDENCE.has(entry)) {
      throw new Error(`template.requiredEvidence[${index}] must be extension, frame_rate, offline, proxy, or path`);
    }
    return entry as FacilityIntakeTemplate["requiredEvidence"][number];
  });
  if (new Set(requiredEvidence).size !== requiredEvidence.length) throw new Error("template.requiredEvidence contains duplicate entries");

  const organizationRules = boundedArray(input.organizationRules, "template.organizationRules", MAX_PROJECT_INTAKE_RULES).map((entry, index) => {
    const rule = asRecord(entry, `template.organizationRules[${index}]`);
    assertOnlyKeys(rule, ["id", "destinationBinName", "match", "colorIndex"], `template.organizationRules[${index}]`);
    const match = asRecord(rule.match, `template.organizationRules[${index}].match`);
    assertOnlyKeys(match, ["filenamePrefixes", "extensions"], `template.organizationRules[${index}].match`);
    const filenamePrefixes = normalizePrefixes(match.filenamePrefixes, `template.organizationRules[${index}].match.filenamePrefixes`);
    const extensions = normalizeExtensions(match.extensions, `template.organizationRules[${index}].match.extensions`);
    if (!filenamePrefixes.length && !extensions.length) {
      throw new Error(`template.organizationRules[${index}].match must include a filename prefix or extension`);
    }
    const colorIndex = rule.colorIndex;
    if (colorIndex !== undefined && (!Number.isInteger(colorIndex) || typeof colorIndex !== "number" || colorIndex < 0 || colorIndex > 14)) {
      throw new Error(`template.organizationRules[${index}].colorIndex must be an integer from 0 through 14`);
    }
    return {
      id: requiredText(rule.id, `template.organizationRules[${index}].id`, 128),
      destinationBinName: requiredText(rule.destinationBinName, `template.organizationRules[${index}].destinationBinName`, 255),
      match: {
        ...(filenamePrefixes.length ? { filenamePrefixes } : {}),
        ...(extensions.length ? { extensions } : {}),
      },
      ...(colorIndex === undefined ? {} : { colorIndex }),
    };
  });
  if (new Set(organizationRules.map((rule) => rule.id)).size !== organizationRules.length) {
    throw new Error("template.organizationRules contains duplicate ids");
  }

  const proxyPolicy = input.proxyPolicy === undefined ? "ignore" : input.proxyPolicy;
  if (proxyPolicy !== "ignore" && proxyPolicy !== "report_missing" && proxyPolicy !== "require") {
    throw new Error("template.proxyPolicy must be ignore, report_missing, or require");
  }

  return {
    schemaVersion: PROJECT_INTAKE_TEMPLATE_SCHEMA_VERSION,
    id: requiredText(input.id, "template.id", 128),
    version: requiredText(input.version, "template.version", 128),
    requiredBins: requiredBins.sort((left, right) => `${left.parentPath ?? ""}/${left.name}`.localeCompare(`${right.parentPath ?? ""}/${right.name}`)),
    allowedExtensions: normalizeExtensions(input.allowedExtensions, "template.allowedExtensions"),
    allowedFrameRates: normalizeFrameRates(input.allowedFrameRates, "template.allowedFrameRates"),
    proxyPolicy,
    approvedPathPrefixes: approvedPathPrefixes.sort((left, right) => left.id.localeCompare(right.id)),
    requiredEvidence: requiredEvidence.sort(),
    organizationRules: organizationRules.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function validateProjectIntakeSnapshot(value: unknown): ProjectIntakeSnapshot {
  const input = asRecord(value, "snapshot");
  assertOnlyKeys(input, ["project", "items", "truncated", "unavailableEvidence"], "snapshot");
  const project = asRecord(input.project, "snapshot.project");
  assertOnlyKeys(project, ["id", "name"], "snapshot.project");
  const items = boundedArray(input.items, "snapshot.items", MAX_PROJECT_INTAKE_ITEMS).map((entry, index) => {
    const item = asRecord(entry, `snapshot.items[${index}]`);
    assertOnlyKeys(item, ["id", "name", "type", "parentId", "treePath", "mediaPath", "offline", "hasProxy", "frameRate"], `snapshot.items[${index}]`);
    if (typeof item.type !== "string" || !ITEM_TYPES.has(item.type)) {
      throw new Error(`snapshot.items[${index}].type must be clip, bin, sequence, or other`);
    }
    const frameRateSupported = item.frameRate === undefined
      || (typeof item.frameRate === "number" && Number.isFinite(item.frameRate) && item.frameRate >= 1 && item.frameRate <= 240);
    return {
      id: requiredText(item.id, `snapshot.items[${index}].id`, 512),
      name: requiredText(item.name, `snapshot.items[${index}].name`, 255),
      type: item.type as ProjectIntakeItem["type"],
      ...(optionalText(item.parentId, `snapshot.items[${index}].parentId`, 512) ? { parentId: optionalText(item.parentId, `snapshot.items[${index}].parentId`, 512) } : {}),
      ...(optionalText(item.treePath, `snapshot.items[${index}].treePath`, 4096) ? { treePath: optionalText(item.treePath, `snapshot.items[${index}].treePath`, 4096) } : {}),
      ...(optionalText(item.mediaPath, `snapshot.items[${index}].mediaPath`, 4096) ? { mediaPath: optionalText(item.mediaPath, `snapshot.items[${index}].mediaPath`, 4096) } : {}),
      ...(optionalBoolean(item.offline, `snapshot.items[${index}].offline`) === undefined ? {} : { offline: optionalBoolean(item.offline, `snapshot.items[${index}].offline`) }),
      ...(optionalBoolean(item.hasProxy, `snapshot.items[${index}].hasProxy`) === undefined ? {} : { hasProxy: optionalBoolean(item.hasProxy, `snapshot.items[${index}].hasProxy`) }),
      ...(item.frameRate === undefined || !frameRateSupported
        ? (frameRateSupported ? {} : { frameRateUnsupported: true as const })
        : { frameRate: Number((item.frameRate as number).toFixed(6)) }),
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("snapshot.items contains duplicate ids");

  const unavailableEvidence = boundedArray(input.unavailableEvidence, "snapshot.unavailableEvidence", MAX_PROJECT_INTAKE_RULES).map((entry, index) =>
    requiredText(entry, `snapshot.unavailableEvidence[${index}]`, 128),
  );
  if (new Set(unavailableEvidence).size !== unavailableEvidence.length) throw new Error("snapshot.unavailableEvidence contains duplicate entries");
  if (typeof input.truncated !== "boolean") throw new Error("snapshot.truncated must be a boolean");

  return {
    project: {
      id: requiredText(project.id, "snapshot.project.id", 512),
      ...(optionalText(project.name, "snapshot.project.name", 255) ? { name: optionalText(project.name, "snapshot.project.name", 255) } : {}),
    },
    items: items.sort((left, right) => left.id.localeCompare(right.id)),
    truncated: input.truncated,
    unavailableEvidence: unavailableEvidence.sort(),
  };
}

function ruleMatches(item: ProjectIntakeItem, rule: OrganizationRule): boolean {
  const name = item.name.toLocaleLowerCase();
  const extension = fileExtension(item);
  const prefixes = rule.match.filenamePrefixes ?? [];
  const extensions = rule.match.extensions ?? [];
  return (!prefixes.length || prefixes.some((prefix) => name.startsWith(prefix)))
    && (!extensions.length || (extension !== undefined && extensions.includes(extension)));
}

export function buildProjectIntakeReport(
  snapshotValue: unknown,
  templateValue: unknown,
  options: BuildProjectIntakeOptions = {},
): ProjectIntakeReport {
  const snapshot = validateProjectIntakeSnapshot(snapshotValue);
  const template = validateFacilityIntakeTemplate(templateValue);
  const includePaths = options.includePaths === true;
  const templateDigest = digest(template);
  const projectRevision = digest(snapshot);
  const findings: ProjectIntakeFinding[] = [];
  const requiredUnavailable = new Set<string>();

  if (snapshot.truncated) {
    pushFinding(findings, {
      code: "CAPTURE_TRUNCATED",
      severity: "error",
      certainty: "unavailable",
      expected: { maximumItems: MAX_PROJECT_INTAKE_ITEMS },
      observed: { itemCount: snapshot.items.length },
    });
  }

  for (const evidence of snapshot.unavailableEvidence) {
    const normalized = evidence.toLocaleLowerCase();
    if (REQUIRED_EVIDENCE.has(normalized) && isRequired(template, normalized as FacilityIntakeTemplate["requiredEvidence"][number])) {
      requiredUnavailable.add(normalized);
      pushFinding(findings, {
        code: "REQUIRED_EVIDENCE_UNAVAILABLE",
        severity: "error",
        certainty: "unavailable",
        expected: { evidence: normalized },
      });
    }
  }

  const bins = snapshot.items.filter((item) => item.type === "bin");
  for (const rule of template.requiredBins) {
    const nameMatches = bins.filter((item) => item.name.toLocaleLowerCase() === rule.name.toLocaleLowerCase());
    if (!nameMatches.length) {
      pushFinding(findings, {
        code: "REQUIRED_BIN_MISSING",
        severity: "error",
        certainty: "observed",
        expected: { name: rule.name, ...(rule.parentPath ? { parentPath: rule.parentPath } : {}) },
      });
      continue;
    }
    if (!rule.parentPath) continue;
    const expectedParent = normalizeTreePath(rule.parentPath);
    const pathKnown = nameMatches.some((item) => parentTreePath(item) !== undefined);
    const parentMatches = nameMatches.filter((item) => {
      const parent = parentTreePath(item);
      return parent === expectedParent || parent?.endsWith(`/${expectedParent}`) === true;
    });
    if (parentMatches.length) continue;
    if (!pathKnown) {
      requiredUnavailable.add("bin_parent_path");
      pushFinding(findings, {
        code: "REQUIRED_BIN_PARENT_UNAVAILABLE",
        severity: "error",
        certainty: "unavailable",
        expected: { name: rule.name, parentPath: rule.parentPath },
      });
    } else {
      pushFinding(findings, {
        code: "REQUIRED_BIN_WRONG_PARENT",
        severity: "error",
        certainty: "observed",
        expected: { name: rule.name, parentPath: rule.parentPath },
        observed: { matchingBinIds: nameMatches.map((item) => item.id).sort() },
      });
    }
  }

  const clips = snapshot.items.filter((item) => item.type === "clip");
  for (const item of clips) {
    const extension = fileExtension(item);
    if (template.allowedExtensions.length || isRequired(template, "extension")) {
      if (!extension) {
        requiredUnavailable.add("extension");
        pushFinding(findings, {
          code: "EXTENSION_UNAVAILABLE",
          severity: "error",
          certainty: "unavailable",
          itemId: item.id,
          expected: { allowedExtensions: template.allowedExtensions },
        });
      } else if (!template.allowedExtensions.includes(extension)) {
        pushFinding(findings, {
          code: "EXTENSION_NOT_ALLOWED",
          severity: "error",
          certainty: "observed",
          itemId: item.id,
          expected: { allowedExtensions: template.allowedExtensions },
          observed: { extension },
        });
      }
    }

    if (template.allowedFrameRates.length || isRequired(template, "frame_rate")) {
      if (item.frameRateUnsupported === true) {
        requiredUnavailable.add("frame_rate");
        pushFinding(findings, {
          code: "FRAME_RATE_UNSUPPORTED",
          severity: "error",
          certainty: "unavailable",
          itemId: item.id,
          expected: { allowedFrameRates: template.allowedFrameRates },
        });
      } else if (item.frameRate === undefined) {
        requiredUnavailable.add("frame_rate");
        pushFinding(findings, {
          code: "FRAME_RATE_UNAVAILABLE",
          severity: "error",
          certainty: "unavailable",
          itemId: item.id,
          expected: { allowedFrameRates: template.allowedFrameRates },
        });
      } else if (!template.allowedFrameRates.some((rate) => frameRateMatches(item.frameRate!, rate))) {
        pushFinding(findings, {
          code: "FRAME_RATE_NOT_ALLOWED",
          severity: "error",
          certainty: "observed",
          itemId: item.id,
          expected: { allowedFrameRates: template.allowedFrameRates },
          observed: { frameRate: item.frameRate },
        });
      }
    }

    if (item.offline === true) {
      pushFinding(findings, {
        code: "OFFLINE_MEDIA",
        severity: "error",
        certainty: "observed",
        itemId: item.id,
        observed: { offline: true },
      });
    } else if (item.offline === undefined && isRequired(template, "offline")) {
      requiredUnavailable.add("offline");
      pushFinding(findings, {
        code: "OFFLINE_STATE_UNAVAILABLE",
        severity: "error",
        certainty: "unavailable",
        itemId: item.id,
      });
    }

    if (template.proxyPolicy !== "ignore" || isRequired(template, "proxy")) {
      if (item.hasProxy === false) {
        pushFinding(findings, {
          code: "PROXY_MISSING",
          severity: template.proxyPolicy === "require" ? "error" : "warning",
          certainty: "observed",
          itemId: item.id,
          expected: { proxyPolicy: template.proxyPolicy },
          observed: { hasProxy: false },
        });
      } else if (item.hasProxy === undefined) {
        if (template.proxyPolicy === "require" || isRequired(template, "proxy")) {
          requiredUnavailable.add("proxy");
          pushFinding(findings, {
            code: "PROXY_STATE_UNAVAILABLE",
            severity: "error",
            certainty: "unavailable",
            itemId: item.id,
            expected: { proxyPolicy: template.proxyPolicy },
          });
        } else {
          pushFinding(findings, {
            code: "PROXY_STATE_NOT_CHECKED",
            severity: "info",
            certainty: "not_checked",
            itemId: item.id,
          });
        }
      }
    }

    if (template.approvedPathPrefixes.length || isRequired(template, "path")) {
      if (!item.mediaPath) {
        requiredUnavailable.add("path");
        pushFinding(findings, {
          code: "MEDIA_PATH_UNAVAILABLE",
          severity: "error",
          certainty: "unavailable",
          itemId: item.id,
          expected: { approvedPathPrefixIds: template.approvedPathPrefixes.map((prefix) => prefix.id) },
        });
      } else {
        const normalizedPath = normalizeFilesystemPath(item.mediaPath);
        const matches = template.approvedPathPrefixes.filter((prefix) => normalizedPath === normalizeFilesystemPath(prefix.prefix)
          || normalizedPath.startsWith(`${normalizeFilesystemPath(prefix.prefix)}/`));
        if (!matches.length) {
          pushFinding(findings, {
            code: "MEDIA_PATH_NOT_APPROVED",
            severity: "error",
            certainty: "observed",
            itemId: item.id,
            expected: { approvedPathPrefixIds: template.approvedPathPrefixes.map((prefix) => prefix.id) },
            observed: pathEvidence(item.mediaPath, includePaths),
          });
        }
      }
    }
  }

  const existingBinNames = new Set(bins.map((item) => item.name.toLocaleLowerCase()));
  const proposedMoves: ProjectIntakeOrganizationPlan["proposedMoves"] = [];
  for (const item of clips) {
    const matches = template.organizationRules.filter((rule) => ruleMatches(item, rule));
    if (matches.length > 1) {
      pushFinding(findings, {
        code: "AMBIGUOUS_ORGANIZATION_RULES",
        severity: "warning",
        certainty: "observed",
        itemId: item.id,
        observed: { matchingRuleIds: matches.map((rule) => rule.id).sort() },
      });
      continue;
    }
    const rule = matches[0];
    if (!rule) continue;
    proposedMoves.push({
      projectItemId: item.id,
      ...(item.parentId ? { expectedParentId: item.parentId } : {}),
      destinationBinName: rule.destinationBinName,
      ruleId: rule.id,
      ...(rule.colorIndex === undefined ? {} : { colorIndex: rule.colorIndex }),
    });
  }
  proposedMoves.sort((left, right) => left.projectItemId.localeCompare(right.projectItemId));

  const proposedBins = [...new Set(proposedMoves.map((move) => move.destinationBinName))]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      exists: existingBinNames.has(name.toLocaleLowerCase()),
      createIfApproved: !existingBinNames.has(name.toLocaleLowerCase()),
    }));
  const planDigest = digest({ templateDigest, projectRevision, proposedBins, proposedMoves });
  findings.sort(findingSort);

  const incomplete = snapshot.truncated || requiredUnavailable.size > 0;
  const status: IntakeStatus = incomplete
    ? "incomplete"
    : findings.some((finding) => finding.severity === "error" || finding.severity === "warning")
      ? "needs_attention"
      : "ready";

  return {
    schemaVersion: PROJECT_INTAKE_REPORT_SCHEMA_VERSION,
    applied: false,
    status,
    project: {
      id: snapshot.project.id,
      ...(snapshot.project.name ? { name: snapshot.project.name } : {}),
      revision: projectRevision,
    },
    template: { id: template.id, version: template.version, digest: templateDigest },
    capture: {
      itemCount: snapshot.items.length,
      truncated: snapshot.truncated,
      pathDisclosure: includePaths ? "requested" : "redacted",
    },
    findings,
    organizationPlan: {
      applied: false,
      planDigest,
      proposedBins,
      proposedMoves,
    },
    limitations: [
      "This is a read-only plan. It does not create bins, rename items, move media, apply labels, or change Premiere.",
      ...(snapshot.truncated ? ["The project capture was truncated, so this report is incomplete."] : []),
      ...(requiredUnavailable.size ? ["Required host evidence was unavailable; inspect the affected items before using this report for compliance decisions."] : []),
    ],
  };
}
