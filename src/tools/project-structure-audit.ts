import { createHash } from "node:crypto";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, type BridgeOptions, type CommandResult } from "../bridge/file-bridge.js";

/** Bounded walk: larger projects return a truncated, audit-only report. */
export const MAX_STRUCTURE_AUDIT_ITEMS = 5_000;
/** Moves proposed (and applied) per call; re-audit for the next batch. */
export const MAX_STRUCTURE_MOVES = 200;
/** Violations listed per call; the total is always reported. */
export const MAX_STRUCTURE_VIOLATIONS = 1_000;
const MAX_ROOT_PATTERNS = 200;
const MAX_EXTENSION_RULES = 100;
const MAX_NAME_LENGTH = 255;
const MAX_PATH_SEGMENTS = 16;
const MAX_TREE_DEPTH = 32;
const ROOT_ID = "root";

export interface ProjectStructureRules {
  allowed_root_names?: string[];
  extension_bins?: Record<string, string>;
  sequences_bin?: string;
  max_depth?: number;
  forbid_empty_bins?: boolean;
}

interface NormalizedRules {
  allowedRootNames?: string[];
  extensionBins?: Array<{ extension: string; path: string[] }>;
  sequencesBin?: string[];
  maxDepth?: number;
  forbidEmptyBins: boolean;
}

export type StructureItemKind = "bin" | "sequence" | "clip" | "file" | "other";

export interface StructureSnapshotItem {
  id: string;
  name: string;
  kind: StructureItemKind;
  parentId: string;
  extension?: string;
  childCount?: number;
}

export interface StructureSnapshot {
  project: { id: string; name: string };
  items: StructureSnapshotItem[];
  truncated: boolean;
  skippedReferences: number;
}

export type StructureRule = "allowed_root_names" | "extension_bins" | "sequences_bin" | "max_depth" | "forbid_empty_bins";

export interface StructureViolation {
  item_id: string;
  item_name: string;
  item_kind: StructureItemKind;
  current_bin_path: string;
  rule: StructureRule;
  detail: string;
  proposed_target_bin?: string;
  target_ambiguous?: boolean;
}

export interface StructureMove {
  item_id: string;
  item_name: string;
  item_kind: StructureItemKind;
  from_parent_id: string;
  from_bin_path: string;
  target_bin_path: string;
  rule: "extension_bins" | "sequences_bin";
}

export interface StructurePlan {
  project: { id: string; name: string };
  itemsScanned: number;
  truncated: boolean;
  skippedReferences: number;
  violations: StructureViolation[];
  violationsTotal: number;
  violationsTruncated: boolean;
  moves: StructureMove[];
  movesTotal: number;
  movesTruncated: boolean;
  binsToCreate: string[];
  ambiguousTargets: Array<{ target_bin_path: string; ambiguous_at: string }>;
  planToken: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function checkName(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length) fail(`${label} must be a non-empty string`);
  if (value.length > MAX_NAME_LENGTH) fail(`${label} must be at most ${MAX_NAME_LENGTH} characters`);
  // Control characters are never valid project-panel names.
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must not contain control characters`);
  return value;
}

function parseBinPath(value: unknown, label: string): string[] {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty bin path such as "Audio/SFX"`);
  if (value.length > 1024) fail(`${label} must be at most 1024 characters`);
  const segments = value.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) fail(`${label} may have at most ${MAX_PATH_SEGMENTS} segments`);
  return segments.map((segment, index) => {
    if (!segment.length || segment.trim() !== segment) {
      fail(`${label} segment ${index + 1} must be non-empty without leading or trailing spaces (use "A/B", not "/A/" or "A//B")`);
    }
    return checkName(segment, `${label} segment ${index + 1}`);
  });
}

const RULE_KEYS = new Set(["allowed_root_names", "extension_bins", "sequences_bin", "max_depth", "forbid_empty_bins"]);

/** Strict, bounded validation: unknown keys and out-of-range values are rejected. */
export function validateStructureRules(value: unknown): NormalizedRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("rules must be an object");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !RULE_KEYS.has(key));
  if (unknown.length) fail(`rules has unknown key(s) ${unknown.join(", ")}; accepted keys are ${[...RULE_KEYS].join(", ")}`);
  const rules: NormalizedRules = { forbidEmptyBins: false };

  if (input.allowed_root_names !== undefined) {
    const names = input.allowed_root_names;
    if (!Array.isArray(names) || !names.length) fail("rules.allowed_root_names must be a non-empty array of names or glob patterns");
    if (names.length > MAX_ROOT_PATTERNS) fail(`rules.allowed_root_names may have at most ${MAX_ROOT_PATTERNS} entries`);
    rules.allowedRootNames = names.map((name, index) => checkName(name, `rules.allowed_root_names[${index}]`));
  }

  if (input.extension_bins !== undefined) {
    const map = input.extension_bins;
    if (!map || typeof map !== "object" || Array.isArray(map)) fail("rules.extension_bins must be an object mapping \".ext\" to a bin path");
    const entries = Object.entries(map as Record<string, unknown>);
    if (!entries.length) fail("rules.extension_bins must contain at least one extension");
    if (entries.length > MAX_EXTENSION_RULES) fail(`rules.extension_bins may have at most ${MAX_EXTENSION_RULES} extensions`);
    const seen = new Set<string>();
    rules.extensionBins = entries.map(([key, path]) => {
      if (!/^\.[A-Za-z0-9]{1,16}$/.test(key)) fail(`rules.extension_bins key ${JSON.stringify(key)} must look like ".wav" (dot plus 1-16 letters or digits)`);
      const extension = key.toLowerCase();
      if (seen.has(extension)) fail(`rules.extension_bins lists ${extension} more than once (keys are case-insensitive)`);
      seen.add(extension);
      return { extension, path: parseBinPath(path, `rules.extension_bins[${key}]`) };
    });
  }

  if (input.sequences_bin !== undefined) rules.sequencesBin = parseBinPath(input.sequences_bin, "rules.sequences_bin");

  if (input.max_depth !== undefined) {
    const depth = input.max_depth;
    if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > MAX_TREE_DEPTH) fail(`rules.max_depth must be an integer from 1 through ${MAX_TREE_DEPTH}`);
    rules.maxDepth = depth;
    const targets = [...(rules.extensionBins ?? []).map((rule) => rule.path), ...(rules.sequencesBin ? [rules.sequencesBin] : [])];
    const tooDeep = targets.find((path) => path.length > depth);
    if (tooDeep) fail(`target bin ${tooDeep.join("/")} is deeper than rules.max_depth ${depth}; the plan would create a violation`);
  }

  if (input.forbid_empty_bins !== undefined) {
    if (typeof input.forbid_empty_bins !== "boolean") fail("rules.forbid_empty_bins must be a boolean");
    rules.forbidEmptyBins = input.forbid_empty_bins;
  }

  if (!rules.allowedRootNames && !rules.extensionBins && !rules.sequencesBin && rules.maxDepth === undefined && !rules.forbidEmptyBins) {
    fail("rules must set at least one of allowed_root_names, extension_bins, sequences_bin, max_depth, or forbid_empty_bins: true");
  }
  return rules;
}

/** Linear-time glob match: `*` matches any run of characters, `?` one character. Case-sensitive. */
export function matchesNameGlob(name: string, pattern: string): boolean {
  let n = 0;
  let p = 0;
  let star = -1;
  let resume = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === name[n])) { n++; p++; }
    else if (p < pattern.length && pattern[p] === "*") { star = p++; resume = n; }
    else if (star >= 0) { p = star + 1; n = ++resume; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

function validateSnapshot(value: unknown): StructureSnapshot {
  const bad = () => fail("Premiere returned an invalid project-structure snapshot; nothing was changed");
  if (!value || typeof value !== "object") return bad();
  const snapshot = value as StructureSnapshot;
  if (!snapshot.project || typeof snapshot.project.id !== "string" || !Array.isArray(snapshot.items)) return bad();
  if (snapshot.items.length > MAX_STRUCTURE_AUDIT_ITEMS) return bad();
  for (const item of snapshot.items) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || typeof item.parentId !== "string") return bad();
  }
  return {
    project: { id: snapshot.project.id, name: String(snapshot.project.name ?? "") },
    items: snapshot.items,
    truncated: snapshot.truncated === true,
    skippedReferences: typeof snapshot.skippedReferences === "number" ? snapshot.skippedReferences : 0,
  };
}

/** Pure evaluator: same snapshot plus rules always yields the same plan and token. */
export function evaluateProjectStructure(rawSnapshot: unknown, rawRules: unknown): StructurePlan {
  const rules = validateStructureRules(rawRules);
  const snapshot = validateSnapshot(rawSnapshot);
  const byId = new Map(snapshot.items.map((item) => [item.id, item]));
  const childBins = new Map<string, StructureSnapshotItem[]>();
  for (const item of snapshot.items) {
    if (item.kind !== "bin") continue;
    const list = childBins.get(item.parentId) ?? [];
    list.push(item);
    childBins.set(item.parentId, list);
  }
  const pathOf = (binId: string): string => {
    const names: string[] = [];
    let current = byId.get(binId);
    for (let guard = 0; current && guard <= MAX_TREE_DEPTH + 1; guard++) {
      names.unshift(current.name);
      current = byId.get(current.parentId);
    }
    return names.length ? names.join("/") : "/";
  };
  const depthOf = (binId: string): number => {
    let depth = 0;
    for (let current = byId.get(binId); current && depth <= MAX_TREE_DEPTH + 1; current = byId.get(current.parentId)) depth++;
    return depth;
  };
  const isWithin = (parentId: string, binId: string): boolean => {
    for (let id: string | undefined = parentId, guard = 0; id && guard <= MAX_TREE_DEPTH + 1; guard++) {
      if (id === binId) return true;
      id = byId.get(id)?.parentId;
    }
    return false;
  };
  type Resolution = { status: "exists"; binId: string } | { status: "missing" } | { status: "ambiguous"; at: string };
  const resolutions = new Map<string, Resolution>();
  const resolve = (segments: string[]): Resolution => {
    const key = segments.join("/");
    const cached = resolutions.get(key);
    if (cached) return cached;
    let current = ROOT_ID;
    let result: Resolution | undefined;
    for (let i = 0; i < segments.length && !result; i++) {
      const matches = (childBins.get(current) ?? []).filter((bin) => bin.name === segments[i]);
      if (matches.length > 1) result = { status: "ambiguous", at: segments.slice(0, i + 1).join("/") };
      else if (!matches.length) result = { status: "missing" };
      else current = matches[0].id;
    }
    const final = result ?? { status: "exists", binId: current };
    resolutions.set(key, final);
    return final;
  };

  const violations: StructureViolation[] = [];
  const moves: StructureMove[] = [];
  const ambiguous = new Map<string, string>();
  const binPathOfParent = (item: StructureSnapshotItem) => item.parentId === ROOT_ID ? "/" : pathOf(item.parentId);

  const placementRule = (item: StructureSnapshotItem, rule: "extension_bins" | "sequences_bin", segments: string[], why: string) => {
    const resolution = resolve(segments);
    const target = segments.join("/");
    if (resolution.status === "exists" && isWithin(item.parentId, resolution.binId)) return;
    const violation: StructureViolation = {
      item_id: item.id,
      item_name: item.name,
      item_kind: item.kind,
      current_bin_path: binPathOfParent(item),
      rule,
      detail: `${why} belongs in ${target}`,
      proposed_target_bin: target,
    };
    if (resolution.status === "ambiguous") {
      violation.target_ambiguous = true;
      violation.detail += `, but more than one bin is named ${resolution.at}; rename one before applying`;
      ambiguous.set(target, resolution.at);
    } else {
      moves.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, from_parent_id: item.parentId, from_bin_path: violation.current_bin_path, target_bin_path: target, rule });
    }
    violations.push(violation);
  };

  for (const item of snapshot.items) {
    if (rules.allowedRootNames && item.parentId === ROOT_ID && !rules.allowedRootNames.some((pattern) => matchesNameGlob(item.name, pattern))) {
      violations.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, current_bin_path: "/", rule: "allowed_root_names", detail: "Name is not in allowed_root_names for the project root" });
    }
    if (item.kind === "bin") {
      const depth = depthOf(item.id);
      if (rules.maxDepth !== undefined && depth > rules.maxDepth) {
        violations.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, current_bin_path: binPathOfParent(item), rule: "max_depth", detail: `Bin is nested ${depth} levels deep; max_depth is ${rules.maxDepth}` });
      }
      if (rules.forbidEmptyBins && item.childCount === 0) {
        violations.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, current_bin_path: binPathOfParent(item), rule: "forbid_empty_bins", detail: "Bin is empty (reported only; this tool never deletes bins)" });
      }
      continue;
    }
    if (item.kind === "sequence" && rules.sequencesBin) {
      placementRule(item, "sequences_bin", rules.sequencesBin, "Sequence");
    } else if ((item.kind === "clip" || item.kind === "file") && rules.extensionBins && item.extension) {
      const extension = item.extension.toLowerCase();
      const match = rules.extensionBins.find((rule) => rule.extension === extension);
      if (match) placementRule(item, "extension_bins", match.path, `${extension} media`);
    }
  }

  const plannedMoves = moves.slice(0, MAX_STRUCTURE_MOVES);
  const binsToCreate = [...new Set(plannedMoves.map((move) => move.target_bin_path))].filter((path) => resolve(path.split("/")).status === "missing");
  const ambiguousTargets = [...ambiguous.entries()].map(([target_bin_path, ambiguous_at]) => ({ target_bin_path, ambiguous_at }));
  const planToken = createHash("sha256").update(JSON.stringify({
    version: 1,
    projectId: snapshot.project.id,
    truncated: snapshot.truncated,
    rules,
    moves: plannedMoves.map((move) => [move.item_id, move.from_parent_id, move.target_bin_path]),
    binsToCreate,
    ambiguousTargets,
  })).digest("hex");

  return {
    project: snapshot.project,
    itemsScanned: snapshot.items.length,
    truncated: snapshot.truncated,
    skippedReferences: snapshot.skippedReferences,
    violations: violations.slice(0, MAX_STRUCTURE_VIOLATIONS),
    violationsTotal: violations.length,
    violationsTruncated: violations.length > MAX_STRUCTURE_VIOLATIONS,
    moves: plannedMoves,
    movesTotal: moves.length,
    movesTruncated: moves.length > MAX_STRUCTURE_MOVES,
    binsToCreate,
    ambiguousTargets,
    planToken,
  };
}

/**
 * Read-only capture of the bounded fields the evaluator needs. Media paths are
 * read only to derive a lowercase extension and are never returned.
 */
export function projectStructureCaptureScript(maxItems: number = MAX_STRUCTURE_AUDIT_ITEMS): string {
  const limit = Math.max(1, Math.min(MAX_STRUCTURE_AUDIT_ITEMS, Math.floor(maxItems)));
  return buildToolScript(`
    var project = app.project;
    if (!project || !project.rootItem) return __error("No project is open");
    var maximumItems = ${limit};
    var items = [];
    var truncated = false;
    var seen = {};
    var skippedReferences = 0;

    function extensionOf(text) {
      if (!text) return "";
      var value = String(text);
      var slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\\\"));
      var dot = value.lastIndexOf(".");
      if (dot <= slash + 1 || dot === value.length - 1) return "";
      return value.substring(dot).toLowerCase();
    }

    function walk(parent, parentId, depth) {
      if (depth > ${MAX_TREE_DEPTH}) { truncated = true; return; }
      var count = __childCount(parent);
      for (var i = 0; i < count; i++) {
        if (items.length >= maximumItems) { truncated = true; return; }
        var item = __childAt(parent, i);
        if (!item) continue;
        var id = __nodeIdOf(item);
        if (!id) continue;
        // Smart bins list references to items stored elsewhere; count each node once.
        if (seen[id]) { skippedReferences++; continue; }
        seen[id] = true;
        var kind = __projectItemKind(item);
        if (kind !== "bin" && kind !== "sequence" && kind !== "clip" && kind !== "file") kind = "other";
        var entry = { id: id, name: String(item.name), kind: kind, parentId: parentId };
        if (kind === "clip" || kind === "file") {
          var ext = "";
          try { ext = extensionOf(item.getMediaPath()); } catch (eMedia) {}
          if (!ext) ext = extensionOf(item.name);
          if (ext) entry.extension = ext;
        }
        if (kind === "bin") entry.childCount = __childCount(item);
        items.push(entry);
        if (kind === "bin") walk(item, id, depth + 1);
        if (truncated) return;
      }
    }

    walk(project.rootItem, "${ROOT_ID}", 0);
    var projectId = "";
    try { if (project.documentID) projectId = String(project.documentID); } catch (eId) {}
    if (!projectId) projectId = String(project.name);
    return __result({ project: { id: projectId, name: String(project.name) }, items: items, truncated: truncated, skippedReferences: skippedReferences });
  `);
}

/**
 * Apply a reviewed plan: resolve every target path read-only first (refusing on
 * a duplicate bin name at any level), create missing bins, then move each item
 * whose parent is unchanged since the audit and read back its parent bin.
 * Never deletes or renames anything.
 */
export function projectStructureApplyScript(plan: StructurePlan): string {
  const targets = [...new Set(plan.moves.map((move) => move.target_bin_path))];
  const targetIndex = new Map(targets.map((path, index) => [path, index]));
  const quote = (value: string) => `"${escapeForExtendScript(value)}"`;
  const targetLiteral = targets.map((path) => `[${path.split("/").map(quote).join(",")}]`).join(",");
  const moveLiteral = plan.moves.map((move) => `{itemId:${quote(move.item_id)},name:${quote(move.item_name)},fromParentId:${quote(move.from_parent_id)},target:${targetIndex.get(move.target_bin_path)}}`).join(",\n");
  return buildToolScript(`
    if (!app.project || !app.project.rootItem) return __error("No project is open");
    var root = app.project.rootItem;
    var targets = [${targetLiteral}];
    var moves = [${moveLiteral}];

    function joinPath(segments, end) {
      var out = "";
      for (var j = 0; j < end; j++) out += (j ? "/" : "") + segments[j];
      return out;
    }
    function binsNamed(parent, name) {
      var out = [];
      var count = __childCount(parent);
      for (var k = 0; k < count; k++) {
        var child = __childAt(parent, k);
        if (child && __isBinItem(child) && String(child.name) === name) out.push(child);
      }
      return out;
    }

    // Phase 1, read-only: resolve every target and refuse on ambiguity.
    var resolved = [];
    for (var t = 0; t < targets.length; t++) {
      var current = root;
      var missingFrom = -1;
      for (var s = 0; s < targets[t].length; s++) {
        var found = binsNamed(current, targets[t][s]);
        if (found.length > 1) return __error("More than one bin is named " + joinPath(targets[t], s + 1) + "; the target is ambiguous, so nothing was created or moved.", { outcome: "failed", mutationOutcome: "not_applied", ambiguousTarget: joinPath(targets[t], targets[t].length) });
        if (found.length === 0) { missingFrom = s; break; }
        current = found[0];
      }
      resolved.push({ bin: missingFrom < 0 ? current : null, parent: current, missingFrom: missingFrom });
    }

    // Phase 2: create missing bins, reading each one back under its parent.
    var createdBins = [];
    for (var c = 0; c < targets.length; c++) {
      if (resolved[c].missingFrom < 0) continue;
      var parent = resolved[c].parent;
      for (var cs = resolved[c].missingFrom; cs < targets[c].length; cs++) {
        var segment = targets[c][cs];
        var existing = binsNamed(parent, segment);
        if (existing.length > 1) return __error("More than one bin is named " + joinPath(targets[c], cs + 1) + "; stopped before moving anything.", { outcome: createdBins.length ? "committed_unverified" : "failed", createdBins: createdBins, moves: [] });
        if (existing.length === 1) { parent = existing[0]; continue; }
        var before = {};
        var beforeCount = __childCount(parent);
        for (var b = 0; b < beforeCount; b++) { var prior = __childAt(parent, b); if (prior) before[__nodeIdOf(prior)] = true; }
        var made = null;
        try { made = parent.createBin(segment); } catch (eCreate) {}
        var created = null;
        var afterCount = __childCount(parent);
        for (var a = 0; a < afterCount; a++) {
          var candidate = __childAt(parent, a);
          if (candidate && !before[__nodeIdOf(candidate)] && __isBinItem(candidate) && String(candidate.name) === segment) { created = candidate; break; }
        }
        if (!created && made && __nodeIdOf(made)) {
          // Premiere can place a new bin in the root; move it under the parent.
          try { made.moveBin(parent); } catch (eMoveBin) {}
          if (__isDirectChild(parent, made)) created = made;
        }
        if (!created) return __error("Premiere did not create bin " + joinPath(targets[c], cs + 1) + "; no items were moved.", { outcome: createdBins.length ? "committed_unverified" : "failed", createdBins: createdBins, moves: [] });
        createdBins.push({ path: joinPath(targets[c], cs + 1), nodeId: __nodeIdOf(created), verified: true });
        parent = created;
      }
      resolved[c].bin = parent;
    }

    // Phase 3: move only items still where the audit saw them; read back each parent.
    var results = [];
    var verifiedCount = 0;
    for (var m = 0; m < moves.length; m++) {
      var move = moves[m];
      var targetBin = resolved[move.target].bin;
      var entry = { item_id: move.itemId, item_name: move.name, target_bin_path: joinPath(targets[move.target], targets[move.target].length), target_bin_id: __nodeIdOf(targetBin), status: "failed" };
      var item = __findProjectItemByNodeId(move.itemId);
      if (!item) { entry.reason = "item_not_found"; results.push(entry); continue; }
      var fromParent = move.fromParentId === "${ROOT_ID}" ? root : __findProjectItemByNodeId(move.fromParentId);
      if (!fromParent || !__isDirectChild(fromParent, item)) { entry.reason = "moved_since_audit"; results.push(entry); continue; }
      try { item.moveBin(targetBin); } catch (eMove) { entry.hostError = String(eMove); }
      if (__isDirectChild(targetBin, item) && !__isDirectChild(fromParent, item)) {
        entry.status = "verified";
        verifiedCount++;
      } else {
        entry.reason = "parent_readback_mismatch";
      }
      results.push(entry);
    }
    return __result({ createdBins: createdBins, moves: results, verifiedCount: verifiedCount, attempted: moves.length });
  `);
}

export interface ProjectStructureAuditDependencies {
  captureSnapshot?: () => Promise<CommandResult>;
}

type AuditArgs = { rules: unknown; apply?: unknown; plan_token?: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getProjectStructureAuditTools(bridgeOptions: BridgeOptions, dependencies: ProjectStructureAuditDependencies = {}) {
  const capture = dependencies.captureSnapshot ?? (() => sendCommand(projectStructureCaptureScript(), bridgeOptions));
  return {
    audit_project_structure: {
      description:
        `Audit the Project panel against explicit layout rules (allowed root names, extension-to-bin placement, a sequences bin, maximum bin depth, empty bins) and report violations by node ID. ` +
        `Read-only by default (inspect authority): walks up to ${MAX_STRUCTURE_AUDIT_ITEMS} items, reports truncation, and returns at most ${MAX_STRUCTURE_MOVES} proposed moves plus a plan_token bound to the project, rules, and those exact moves. ` +
        `With apply: true (edit authority) it requires that plan_token, re-reads the project and refuses if the plan changed, the walk was truncated, or any target path is ambiguous (two bins with one name at a level). ` +
        `It then creates missing target bins and moves only the planned items, reading back each item's parent bin; outcome is verified only when every move is verified, otherwise partial or failed with per-item details. ` +
        `It never deletes, renames, or moves bins; root-name, depth, and empty-bin findings are report-only.`,
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          rules: {
            type: "object",
            additionalProperties: false,
            description: "Layout rules; at least one must be set. Unknown keys are rejected.",
            properties: {
              allowed_root_names: {
                type: "array",
                minItems: 1,
                maxItems: MAX_ROOT_PATTERNS,
                items: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH },
                description: "Names allowed directly in the project root. Exact, case-sensitive names or simple globs where * matches any characters and ? matches one. Other root items are reported (not moved unless another rule moves them).",
              },
              extension_bins: {
                type: "object",
                additionalProperties: { type: "string", minLength: 1, maxLength: 1024 },
                maxProperties: MAX_EXTENSION_RULES,
                description: `Map of media extension (".wav", case-insensitive, dot plus 1-16 letters or digits) to a slash-separated bin path from the root, e.g. {".wav":"Audio/SFX", ".mp4":"Footage"}. Clips whose media extension matches and that are not already inside that bin (or a bin nested in it) get a proposed move. Up to ${MAX_EXTENSION_RULES} extensions, ${MAX_PATH_SEGMENTS} path segments.`,
              },
              sequences_bin: {
                type: "string",
                minLength: 1,
                maxLength: 1024,
                description: "Slash-separated bin path for sequences, e.g. \"Sequences\" or \"Edit/Sequences\". Sequences outside it (or bins nested in it) get a proposed move.",
              },
              max_depth: {
                type: "integer",
                minimum: 1,
                maximum: MAX_TREE_DEPTH,
                description: "Maximum bin nesting depth (a bin in the root is depth 1). Deeper bins are reported only. Target paths deeper than this are rejected.",
              },
              forbid_empty_bins: {
                type: "boolean",
                description: "Report bins with no children. Report-only: this tool never deletes bins.",
              },
            },
          },
          apply: {
            type: "boolean",
            description: "false (default) audits without changing Premiere. true creates missing target bins and moves the planned items; requires plan_token and the edit capability.",
          },
          plan_token: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
            description: "Required when apply is true: the planToken returned by the audit with the same rules. Apply refuses if the project's current plan no longer matches it.",
          },
        },
        required: ["rules"],
      },
      handler: async (args: AuditArgs) => {
        try {
          if (args.apply !== undefined && typeof args.apply !== "boolean") return { success: false, error: "apply must be a boolean" };
          const apply = args.apply === true;
          validateStructureRules(args.rules);
          if (apply && (typeof args.plan_token !== "string" || !/^[0-9a-f]{64}$/.test(args.plan_token))) {
            return { success: false, error: "apply: true requires plan_token from a prior audit_project_structure call with the same rules. Nothing was changed." };
          }
          if (!apply && args.plan_token !== undefined) return { success: false, error: "plan_token is only accepted with apply: true" };

          const captured = await capture();
          if (!captured.success) return captured;
          const plan = evaluateProjectStructure(captured.data, args.rules);
          if (!apply) {
            return {
              success: true,
              data: {
                applied: false,
                outcome: "audited",
                compliant: plan.violationsTotal === 0,
                applyReady: plan.moves.length > 0 && !plan.truncated && plan.ambiguousTargets.length === 0,
                ...plan,
                limitations: [
                  "Audit only; nothing in Premiere changed.",
                  "Root-name, depth, and empty-bin findings are report-only; apply never deletes, renames, or moves bins.",
                  ...(plan.truncated ? [`The project walk stopped at ${MAX_STRUCTURE_AUDIT_ITEMS} items or ${MAX_TREE_DEPTH} levels; findings are incomplete and apply is refused.`] : []),
                  ...(plan.movesTruncated ? [`Only the first ${MAX_STRUCTURE_MOVES} of ${plan.movesTotal} moves are planned; apply this batch, then audit again.`] : []),
                ],
              },
            };
          }

          const refusal = (error: string, extra: Record<string, unknown> = {}) => ({ success: false, error: `${error} Nothing was changed.`, data: { applied: false, outcome: "failed", mutationOutcome: "not_applied", ...extra } });
          if (plan.planToken !== args.plan_token) return refusal("The project or rules changed since the audit, so the reviewed plan no longer matches; audit again and review the new plan.", { planToken: plan.planToken });
          if (plan.truncated) return refusal(`The project walk was truncated at ${MAX_STRUCTURE_AUDIT_ITEMS} items or ${MAX_TREE_DEPTH} levels, so the plan cannot be applied safely.`);
          if (plan.ambiguousTargets.length) return refusal(`Target bin path(s) are ambiguous: ${plan.ambiguousTargets.map((target) => target.ambiguous_at).join(", ")}. Rename the duplicate bins, then audit again.`, { ambiguousTargets: plan.ambiguousTargets });
          if (!plan.moves.length) return { success: true, data: { applied: false, outcome: "verified", detail: "No moves were planned.", createdBins: [], moves: [], verifiedCount: 0, attempted: 0 } };

          const result = await sendCommand(projectStructureApplyScript(plan), { ...bridgeOptions, mutationOnTimeout: true });
          if (!result.success) return result;
          const data = result.data as { createdBins?: unknown[]; moves?: Array<{ status?: string }>; verifiedCount?: number; attempted?: number };
          const attempted = data.attempted ?? plan.moves.length;
          const verifiedCount = data.verifiedCount ?? 0;
          const outcome = verifiedCount === attempted ? "verified" : verifiedCount > 0 ? "partial" : "failed";
          const summary = { applied: verifiedCount > 0 || (data.createdBins?.length ?? 0) > 0, outcome, ...data, movesRemaining: plan.movesTotal - plan.moves.length };
          if (outcome === "verified") return { success: true, data: summary };
          return { success: false, error: `${verifiedCount} of ${attempted} planned move(s) verified${outcome === "partial" ? "; the project changed" : ""}. See data.moves for per-item reasons; audit again before retrying.`, data: summary };
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      },
    },
  };
}
