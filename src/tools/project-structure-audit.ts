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
/** Explicit target_tree bins per call. */
export const MAX_TARGET_TREE_BINS = 500;
/** Item node IDs across the whole target_tree per call. */
export const MAX_TARGET_TREE_ITEMS = 2_000;
/** Renames planned (and applied) per call. */
export const MAX_STRUCTURE_RENAMES = 200;
/** Empty bins removed per call; re-audit for the next batch. */
export const MAX_STRUCTURE_REMOVALS = 200;
const MAX_NODE_ID_LENGTH = 255;

export interface ProjectStructureRules {
  allowed_root_names?: string[];
  extension_bins?: Record<string, string>;
  sequences_bin?: string;
  max_depth?: number;
  forbid_empty_bins?: boolean;
  target_tree?: Array<{ bin: string; items?: string[] }>;
  rename?: Array<{ item_id: string; name: string }>;
  remove_empty?: boolean;
}

interface NormalizedRules {
  allowedRootNames?: string[];
  extensionBins?: Array<{ extension: string; path: string[] }>;
  sequencesBin?: string[];
  maxDepth?: number;
  forbidEmptyBins: boolean;
  targetTree?: Array<{ path: string[]; items: string[] }>;
  renames?: Array<{ itemId: string; name: string }>;
  removeEmpty: boolean;
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

export type StructureRule = "allowed_root_names" | "extension_bins" | "sequences_bin" | "max_depth" | "forbid_empty_bins" | "target_tree" | "rename" | "remove_empty";

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
  rule: "extension_bins" | "sequences_bin" | "target_tree";
}

export interface StructureRename {
  item_id: string;
  item_kind: StructureItemKind;
  from_name: string;
  to_name: string;
}

export interface StructureRemoval {
  item_id: string;
  item_name: string;
  bin_path: string;
  parent_id: string;
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
  invalidPlanReasons: string[];
  ambiguousTargets: Array<{ target_bin_path: string; ambiguous_at: string }>;
  /** Bins named by target_tree that must exist after apply (created when missing). */
  targetBins: string[];
  renames: StructureRename[];
  renamesTotal: number;
  renamesTruncated: boolean;
  removals: StructureRemoval[];
  removalsTotal: number;
  removalsTruncated: boolean;
  /** Node IDs named by target_tree or rename that the walk did not find. */
  unresolvedItemIds: string[];
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

const RULE_KEYS = new Set(["allowed_root_names", "extension_bins", "sequences_bin", "max_depth", "forbid_empty_bins", "target_tree", "rename", "remove_empty"]);

function checkNodeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length) fail(`${label} must be a non-empty node ID string`);
  if (value.length > MAX_NODE_ID_LENGTH) fail(`${label} must be at most ${MAX_NODE_ID_LENGTH} characters`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} must not contain control characters`);
  return value;
}

/** Strict, bounded validation: unknown keys and out-of-range values are rejected. */
export function validateStructureRules(value: unknown): NormalizedRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("rules must be an object");
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !RULE_KEYS.has(key));
  if (unknown.length) fail(`rules has unknown key(s) ${unknown.join(", ")}; accepted keys are ${[...RULE_KEYS].join(", ")}`);
  const rules: NormalizedRules = { forbidEmptyBins: false, removeEmpty: false };

  if (input.target_tree !== undefined) {
    const tree = input.target_tree;
    if (!Array.isArray(tree) || !tree.length) fail("rules.target_tree must be a non-empty array of { bin, items? } entries");
    if (tree.length > MAX_TARGET_TREE_BINS) fail(`rules.target_tree may have at most ${MAX_TARGET_TREE_BINS} bins`);
    const seenPaths = new Set<string>();
    const seenItems = new Set<string>();
    let itemCount = 0;
    rules.targetTree = tree.map((entry, index) => {
      const label = `rules.target_tree[${index}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object with bin and optional items`);
      const record = entry as Record<string, unknown>;
      const unknownKeys = Object.keys(record).filter((key) => key !== "bin" && key !== "items");
      if (unknownKeys.length) fail(`${label} has unknown key(s) ${unknownKeys.join(", ")}; accepted keys are bin, items`);
      const path = parseBinPath(record.bin, `${label}.bin`);
      const key = path.join("/");
      if (seenPaths.has(key)) fail(`${label}.bin ${key} is listed more than once`);
      seenPaths.add(key);
      const items: string[] = [];
      if (record.items !== undefined) {
        if (!Array.isArray(record.items)) fail(`${label}.items must be an array of node IDs`);
        record.items.forEach((id, itemIndex) => {
          const nodeId = checkNodeId(id, `${label}.items[${itemIndex}]`);
          if (seenItems.has(nodeId)) fail(`${label}.items[${itemIndex}] ${nodeId} is listed under more than one bin`);
          seenItems.add(nodeId);
          items.push(nodeId);
        });
        itemCount += items.length;
        if (itemCount > MAX_TARGET_TREE_ITEMS) fail(`rules.target_tree may name at most ${MAX_TARGET_TREE_ITEMS} items in total`);
      }
      return { path, items };
    });
  }

  if (input.rename !== undefined) {
    const list = input.rename;
    if (!Array.isArray(list) || !list.length) fail("rules.rename must be a non-empty array of { item_id, name } entries");
    if (list.length > MAX_STRUCTURE_RENAMES) fail(`rules.rename may have at most ${MAX_STRUCTURE_RENAMES} entries`);
    const seen = new Set<string>();
    rules.renames = list.map((entry, index) => {
      const label = `rules.rename[${index}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${label} must be an object with item_id and name`);
      const record = entry as Record<string, unknown>;
      const unknownKeys = Object.keys(record).filter((key) => key !== "item_id" && key !== "name");
      if (unknownKeys.length) fail(`${label} has unknown key(s) ${unknownKeys.join(", ")}; accepted keys are item_id, name`);
      const itemId = checkNodeId(record.item_id, `${label}.item_id`);
      if (seen.has(itemId)) fail(`${label}.item_id ${itemId} is renamed more than once`);
      seen.add(itemId);
      const name = checkName(record.name, `${label}.name`);
      if (name.trim() !== name) fail(`${label}.name must not have leading or trailing spaces`);
      if (name.includes("/")) fail(`${label}.name must not contain "/" (it is the bin path separator)`);
      return { itemId, name };
    });
  }

  if (input.remove_empty !== undefined) {
    if (typeof input.remove_empty !== "boolean") fail("rules.remove_empty must be a boolean");
    rules.removeEmpty = input.remove_empty;
  }

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
    const targets = [...(rules.extensionBins ?? []).map((rule) => rule.path), ...(rules.sequencesBin ? [rules.sequencesBin] : []), ...(rules.targetTree ?? []).map((entry) => entry.path)];
    const tooDeep = targets.find((path) => path.length > depth);
    if (tooDeep) fail(`target bin ${tooDeep.join("/")} is deeper than rules.max_depth ${depth}; the plan would create a violation`);
  }

  if (input.forbid_empty_bins !== undefined) {
    if (typeof input.forbid_empty_bins !== "boolean") fail("rules.forbid_empty_bins must be a boolean");
    rules.forbidEmptyBins = input.forbid_empty_bins;
  }

  if (!rules.allowedRootNames && !rules.extensionBins && !rules.sequencesBin && rules.maxDepth === undefined && !rules.forbidEmptyBins && !rules.targetTree && !rules.renames && !rules.removeEmpty) {
    fail("rules must set at least one of allowed_root_names, extension_bins, sequences_bin, max_depth, forbid_empty_bins: true, target_tree, rename, or remove_empty: true");
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

  const invalidPlanReasons: string[] = [];
  const explicitTargets = new Map((rules.targetTree ?? []).flatMap(entry => entry.items.map(id => [id, entry.path.join("/")] as const)));
  const violations: StructureViolation[] = [];
  const moves: StructureMove[] = [];
  const ambiguous = new Map<string, string>();
  const binPathOfParent = (item: StructureSnapshotItem) => item.parentId === ROOT_ID ? "/" : pathOf(item.parentId);

  const placementRule = (item: StructureSnapshotItem, rule: "extension_bins" | "sequences_bin", segments: string[], why: string) => {
    const resolution = resolve(segments);
    const target = segments.join("/");
    const explicit = explicitTargets.get(item.id);
    if (explicit !== undefined) {
      if (explicit !== target && !explicit.startsWith(`${target}/`)) {
        invalidPlanReasons.push(`Conflicting placement rules for ${item.id}: ${target} and ${explicit}`);
      }
      // Explicit placement is stricter; it is the sole move for this node.
      return;
    }
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

  // Explicit tree: every listed bin must exist; every listed item must sit directly in its bin.
  const unresolved = new Set<string>();
  const targetBins: string[] = [];
  for (const entry of rules.targetTree ?? []) {
    const target = entry.path.join("/");
    targetBins.push(target);
    const resolution = resolve(entry.path);
    if (resolution.status === "ambiguous") ambiguous.set(target, resolution.at);
    for (const itemId of entry.items) {
      const item = byId.get(itemId);
      if (!item) { unresolved.add(itemId); continue; }
      if (resolution.status === "exists" && item.parentId === resolution.binId) continue;
      const violation: StructureViolation = {
        item_id: item.id,
        item_name: item.name,
        item_kind: item.kind,
        current_bin_path: binPathOfParent(item),
        rule: "target_tree",
        detail: `target_tree places this ${item.kind} directly in ${target}`,
        proposed_target_bin: target,
      };
      if (resolution.status === "ambiguous") {
        violation.target_ambiguous = true;
        violation.detail += `, but more than one bin is named ${resolution.at}; rename one before applying`;
      } else if (item.kind === "bin" && entry.path.some((_, index) => {
        const prefix = resolve(entry.path.slice(0, index + 1));
        return prefix.status === "exists" && isWithin(prefix.binId, item.id);
      })) {
        violation.detail += `, but that bin is the item itself or nested inside it; not planned`;
        invalidPlanReasons.push(`Cannot move ${item.id} into itself or a descendant: ${target}`);
      } else {
        moves.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, from_parent_id: item.parentId, from_bin_path: violation.current_bin_path, target_bin_path: target, rule: "target_tree" });
      }
      violations.push(violation);
    }
  }

  const renames: StructureRename[] = [];
  for (const entry of rules.renames ?? []) {
    const item = byId.get(entry.itemId);
    if (!item) { unresolved.add(entry.itemId); continue; }
    if (item.name === entry.name) continue;
    violations.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, current_bin_path: binPathOfParent(item), rule: "rename", detail: `rename to ${entry.name}` });
    renames.push({ item_id: item.id, item_kind: item.kind, from_name: item.name, to_name: entry.name });
  }

  // Validate the complete plan before batching: moving any required prefix would
  // invalidate path-based placements even if intermediate parent checks passed.
  const requiredPaths = [...targetBins, ...moves.map(move => move.target_bin_path),
    ...(rules.extensionBins ?? []).map(entry => entry.path.join("/")),
    ...(rules.sequencesBin ? [rules.sequencesBin.join("/")] : [])];
  for (const move of moves) {
    if (move.item_kind !== "bin") continue;
    for (const path of requiredPaths) {
      const segments = path.split("/");
      if (segments.some((_, index) => {
        const prefix = resolve(segments.slice(0, index + 1));
        return prefix.status === "exists" && isWithin(prefix.binId, move.item_id);
      })) {
        invalidPlanReasons.push(`Moving ${move.item_id} would relocate required target path ${path}`);
      }
    }
  }
  const plannedMoves = moves.slice(0, MAX_STRUCTURE_MOVES);
  const allTargetPaths = [...new Set([...plannedMoves.map((move) => move.target_bin_path), ...targetBins])];
  const binsToCreate = allTargetPaths.filter((path) => resolve(path.split("/")).status === "missing");

  // Bins that must survive apply: every existing prefix of a target path, bins placed by target_tree, and renamed bins.
  const protectedBins = new Set<string>([...(rules.renames ?? []).map((entry) => entry.itemId), ...(rules.targetTree ?? []).flatMap((entry) => entry.items)]);
  for (const path of requiredPaths) {
    const segments = path.split("/");
    for (let end = 1; end <= segments.length; end++) {
      const resolution = resolve(segments.slice(0, end));
      if (resolution.status === "exists") protectedBins.add(resolution.binId);
    }
  }
  const removals: StructureRemoval[] = [];
  if (rules.removeEmpty) {
    for (const item of snapshot.items) {
      if (item.kind !== "bin" || item.childCount !== 0 || protectedBins.has(item.id)) continue;
      violations.push({ item_id: item.id, item_name: item.name, item_kind: item.kind, current_bin_path: binPathOfParent(item), rule: "remove_empty", detail: "Bin is empty; apply deletes it if it is still empty" });
      removals.push({ item_id: item.id, item_name: item.name, bin_path: pathOf(item.id), parent_id: item.parentId });
    }
  }
  const plannedRenames = renames.slice(0, MAX_STRUCTURE_RENAMES);
  const plannedRemovals = removals.slice(0, MAX_STRUCTURE_REMOVALS);
  // Simulate bin operations in apply order, including newly created destinations.
  // Clips and sequences may legitimately share names and are excluded.
  const virtualBins = new Map(snapshot.items.filter(item => item.kind === "bin").map(item => [item.id, { ...item }]));
  const targetIds = new Map<string, string>();
  for (const path of allTargetPaths) {
    let parentId = ROOT_ID;
    let prefix = "";
    for (const name of path.split("/")) {
      prefix = prefix ? `${prefix}/${name}` : name;
      const existing = [...virtualBins.values()].find(bin => bin.parentId === parentId && bin.name === name);
      const id = existing?.id ?? `virtual:${prefix}`;
      if (!existing) virtualBins.set(id, { id, name, parentId, kind: "bin" });
      parentId = id;
    }
    targetIds.set(path, parentId);
  }
  const changeBin = (id: string, parentId: string, name: string) => {
    const bin = virtualBins.get(id);
    if (!bin) return;
    if ([...virtualBins.values()].some(other => other.id !== id && other.parentId === parentId && other.name === name)) {
      invalidPlanReasons.push(`Bin ${id} would collide with sibling bin ${name}`);
    }
    bin.parentId = parentId;
    bin.name = name;
  };
  for (const move of plannedMoves) changeBin(move.item_id, targetIds.get(move.target_bin_path)!, move.item_name);
  for (const removal of plannedRemovals) virtualBins.delete(removal.item_id);
  for (const rename of plannedRenames) {
    const bin = virtualBins.get(rename.item_id);
    if (bin) changeBin(bin.id, bin.parentId, rename.to_name);
  }
  if (!snapshot.project.id.trim() && (plannedMoves.length || binsToCreate.length || plannedRenames.length || plannedRemovals.length)) {
    invalidPlanReasons.push("Project documentID is unavailable; mutation requires stable project identity");
  }
  const unresolvedItemIds = [...unresolved];
  const ambiguousTargets = [...ambiguous.entries()].map(([target_bin_path, ambiguous_at]) => ({ target_bin_path, ambiguous_at }));
  const planToken = createHash("sha256").update(JSON.stringify({
    version: 2,
    projectId: snapshot.project.id,
    truncated: snapshot.truncated,
    rules,
    moves: plannedMoves.map((move) => [move.item_id, move.from_parent_id, move.target_bin_path]),
    binsToCreate,
    targetBins,
    renames: plannedRenames.map((rename) => [rename.item_id, rename.from_name, rename.to_name]),
    removals: plannedRemovals.map((removal) => [removal.item_id, removal.parent_id]),
    unresolvedItemIds,
    invalidPlanReasons,
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
    invalidPlanReasons,
    ambiguousTargets,
    targetBins,
    renames: plannedRenames,
    renamesTotal: renames.length,
    renamesTruncated: renames.length > MAX_STRUCTURE_RENAMES,
    removals: plannedRemovals,
    removalsTotal: removals.length,
    removalsTruncated: removals.length > MAX_STRUCTURE_REMOVALS,
    unresolvedItemIds,
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
    return __result({ project: { id: projectId, name: String(project.name) }, items: items, truncated: truncated, skippedReferences: skippedReferences });
  `);
}

/**
 * Apply a reviewed plan: resolve every target path read-only first (refusing on
 * a duplicate bin name at any level), create missing bins, then move each item
 * whose parent is unchanged since the audit and read back its parent bin.
 * Empty-bin removals and renames follow moves with postcondition readback.
 */
export function projectStructureApplyScript(plan: StructurePlan): string {
  const targets = [...new Set([...plan.moves.map((move) => move.target_bin_path), ...(plan.targetBins ?? [])])];
  const targetIndex = new Map(targets.map((path, index) => [path, index]));
  const quote = (value: string) => `"${escapeForExtendScript(value)}"`;
  const targetLiteral = targets.map((path) => `[${path.split("/").map(quote).join(",")}]`).join(",");
  const moveLiteral = plan.moves.map((move) => `{itemId:${quote(move.item_id)},name:${quote(move.item_name)},fromParentId:${quote(move.from_parent_id)},target:${targetIndex.get(move.target_bin_path)}}`).join(",\n");
  const removalLiteral = (plan.removals ?? []).map((removal) => `{itemId:${quote(removal.item_id)},name:${quote(removal.item_name)},parentId:${quote(removal.parent_id)},path:${quote(removal.bin_path)}}`).join(",\n");
  const renameLiteral = (plan.renames ?? []).map((rename) => `{itemId:${quote(rename.item_id)},fromName:${quote(rename.from_name)},toName:${quote(rename.to_name)}}`).join(",\n");
  return buildToolScript(`
    if (!app.project || !app.project.rootItem) return __error("No project is open");
    var activeId = "";
    try { if (app.project.documentID) activeId = String(app.project.documentID); } catch (eIdentity) {}
    if (!activeId || activeId !== ${quote(plan.project.id)}) return __error("Project identity changed or documentID is unavailable; nothing was changed", { outcome: "failed", mutationOutcome: "not_applied" });
    var root = app.project.rootItem;
    var targets = [${targetLiteral}];
    var moves = [${moveLiteral}];
    var removals = [${removalLiteral}];
    var renames = [${renameLiteral}];

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

    function strictChildCount(bin) {
      try {
        var count = bin.children.numItems;
        return typeof count === "number" && isFinite(count) && count >= 0 && Math.floor(count) === count ? count : null;
      } catch (eCount) { return null; }
    }
    // Phase 4: delete only bins that are still empty now; read back the parent's children.
    var removalResults = [];
    var removedCount = 0;
    for (var r = 0; r < removals.length; r++) {
      var removal = removals[r];
      var rEntry = { item_id: removal.itemId, item_name: removal.name, bin_path: removal.path, status: "failed" };
      var binToRemove = __findProjectItemByNodeId(removal.itemId);
      if (!binToRemove) { rEntry.reason = "bin_not_found"; removalResults.push(rEntry); continue; }
      if (!__isBinItem(binToRemove)) { rEntry.reason = "not_a_bin"; removalResults.push(rEntry); continue; }
      var removeParent = removal.parentId === "${ROOT_ID}" ? root : __findProjectItemByNodeId(removal.parentId);
      if (!removeParent || !__isDirectChild(removeParent, binToRemove)) { rEntry.reason = "moved_since_audit"; removalResults.push(rEntry); continue; }
      var removalChildCount = strictChildCount(binToRemove);
      if (removalChildCount === null) { rEntry.reason = "children_unreadable"; removalResults.push(rEntry); continue; }
      if (removalChildCount !== 0) { rEntry.reason = "not_empty"; rEntry.childCount = removalChildCount; removalResults.push(rEntry); continue; }
      try { binToRemove.deleteBin(); } catch (eDelete) { rEntry.hostError = String(eDelete); }
      var stillThere = false;
      var parentCount = strictChildCount(removeParent);
      var readbackReliable = parentCount !== null;
      for (var pc = 0; pc < parentCount; pc++) {
        var survivor = __childAt(removeParent, pc);
        if (!survivor || !__nodeIdOf(survivor)) { readbackReliable = false; break; }
        if (__nodeIdOf(survivor) === removal.itemId) { stillThere = true; break; }
      }
      if (!readbackReliable || strictChildCount(removeParent) !== parentCount) { rEntry.reason = "parent_readback_unreadable"; }
      else if (stillThere) { rEntry.reason = "parent_readback_mismatch"; } else { rEntry.status = "verified"; removedCount++; }
      removalResults.push(rEntry);
    }

    // Phase 5: rename last, so target paths above were resolved against the audited names.
    var renameResults = [];
    var renamedCount = 0;
    for (var n = 0; n < renames.length; n++) {
      var rename = renames[n];
      var nEntry = { item_id: rename.itemId, from_name: rename.fromName, to_name: rename.toName, status: "failed" };
      var toRename = __findProjectItemByNodeId(rename.itemId);
      if (!toRename) { nEntry.reason = "item_not_found"; renameResults.push(nEntry); continue; }
      if (String(toRename.name) !== rename.fromName) { nEntry.reason = "renamed_since_audit"; nEntry.current_name = String(toRename.name); renameResults.push(nEntry); continue; }
      try { toRename.name = rename.toName; } catch (eRename) { nEntry.hostError = String(eRename); }
      var readback = __findProjectItemByNodeId(rename.itemId);
      if (readback && String(readback.name) === rename.toName) { nEntry.status = "verified"; renamedCount++; }
      else { nEntry.reason = "name_readback_mismatch"; if (readback) nEntry.current_name = String(readback.name); }
      renameResults.push(nEntry);
    }

    return __result({
      createdBins: createdBins,
      moves: results, verifiedCount: verifiedCount, attempted: moves.length,
      removals: removalResults, removedCount: removedCount, removalsAttempted: removals.length,
      renames: renameResults, renamedCount: renamedCount, renamesAttempted: renames.length
    });
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
        `Audit the Project panel against explicit layout rules (allowed root names, extension-to-bin placement, a sequences bin, maximum bin depth, empty bins, an explicit target_tree of bins with item node IDs, renames, remove_empty) and report violations by node ID. ` +
        `Read-only by default (inspect authority): walks up to ${MAX_STRUCTURE_AUDIT_ITEMS} items, reports truncation, and returns at most ${MAX_STRUCTURE_MOVES} proposed moves, ${MAX_STRUCTURE_RENAMES} renames and ${MAX_STRUCTURE_REMOVALS} empty-bin removals plus a plan_token bound to the project, rules, and those exact operations. ` +
        `With apply: true (edit authority) it requires that plan_token, re-reads the project and refuses if the plan changed, the walk was truncated, or any target path is ambiguous (two bins with one name at a level). ` +
        `It then creates missing target bins, moves only the planned items (reading back each parent), deletes only remove_empty bins that are still empty (reading back the parent's children), then renames (reading back each name); target paths are resolved against the audited names, so renames run last. ` +
        `Outcome is verified only when every planned operation is verified, otherwise partial or failed with per-item details. Without target_tree, rename, or remove_empty it never deletes, renames, or moves bins; root-name, depth, and forbid_empty_bins findings are report-only.`,
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
                description: "Report bins with no children. Report-only; use remove_empty: true to delete them on apply.",
              },
              target_tree: {
                type: "array",
                minItems: 1,
                maxItems: MAX_TARGET_TREE_BINS,
                description: `Explicit layout: each entry names a slash-separated bin path that must exist (created on apply when missing) and the node IDs of items (clips, sequences, or bins) that must sit directly in it. Items elsewhere get a proposed move; a node ID the walk does not find is listed in unresolvedItemIds and never moved. Each node ID may appear under one bin only. Up to ${MAX_TARGET_TREE_BINS} bins and ${MAX_TARGET_TREE_ITEMS} items.`,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["bin"],
                  properties: {
                    bin: { type: "string", minLength: 1, maxLength: 1024, description: "Slash-separated bin path from the project root, e.g. \"00 SEQUENCES/01 STRINGOUTS\"." },
                    items: { type: "array", items: { type: "string", minLength: 1, maxLength: MAX_NODE_ID_LENGTH }, description: "Node IDs (from get_bin_contents, list_project_items, or a previous audit) that belong directly in this bin." },
                  },
                },
              },
              rename: {
                type: "array",
                minItems: 1,
                maxItems: MAX_STRUCTURE_RENAMES,
                description: `Items or bins to rename by node ID, applied last with name readback. A name equal to the current one is a no-op. Target paths in other rules are resolved against the names seen at audit time. Up to ${MAX_STRUCTURE_RENAMES} entries.`,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["item_id", "name"],
                  properties: {
                    item_id: { type: "string", minLength: 1, maxLength: MAX_NODE_ID_LENGTH, description: "Node ID of the item or bin to rename." },
                    name: { type: "string", minLength: 1, maxLength: MAX_NAME_LENGTH, description: "New Project-panel name; no leading or trailing spaces, no \"/\"." },
                  },
                },
              },
              remove_empty: {
                type: "boolean",
                description: `Plan deletion of bins that have no children at audit time, except bins on a target path or named in rename. Apply deletes only bins that are still empty, reading back the parent's children. Up to ${MAX_STRUCTURE_REMOVALS} per call; audit again for bins emptied by this apply.`,
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
                compliant: plan.unresolvedItemIds.length === 0 && plan.ambiguousTargets.length === 0 && plan.violationsTotal === 0 && plan.binsToCreate.length === 0 && plan.invalidPlanReasons.length === 0,
                applyReady: (plan.moves.length > 0 || plan.binsToCreate.length > 0 || plan.renames.length > 0 || plan.removals.length > 0) && !plan.truncated && plan.ambiguousTargets.length === 0 && plan.invalidPlanReasons.length === 0,
                ...plan,
                limitations: [
                  "Audit only; nothing in Premiere changed.",
                  "Root-name, depth, and forbid_empty_bins findings are report-only; apply moves, renames, or deletes bins only through target_tree, rename, and remove_empty.",
                  ...(plan.truncated ? [`The project walk stopped at ${MAX_STRUCTURE_AUDIT_ITEMS} items or ${MAX_TREE_DEPTH} levels; findings are incomplete and apply is refused.`] : []),
                  ...(plan.movesTruncated ? [`Only the first ${MAX_STRUCTURE_MOVES} of ${plan.movesTotal} moves are planned; apply this batch, then audit again.`] : []),
                  ...(plan.renamesTruncated ? [`Only the first ${MAX_STRUCTURE_RENAMES} of ${plan.renamesTotal} renames are planned; apply this batch, then audit again.`] : []),
                  ...(plan.removalsTruncated ? [`Only the first ${MAX_STRUCTURE_REMOVALS} of ${plan.removalsTotal} empty-bin removals are planned; apply this batch, then audit again.`] : []),
                  ...(plan.unresolvedItemIds.length ? [`${plan.unresolvedItemIds.length} node ID(s) named in target_tree or rename were not found in the project walk and are not planned; see unresolvedItemIds.`] : []),
                ],
              },
            };
          }

          const refusal = (error: string, extra: Record<string, unknown> = {}) => ({ success: false, error: `${error} Nothing was changed.`, data: { applied: false, outcome: "failed", mutationOutcome: "not_applied", ...extra } });
          if (plan.planToken !== args.plan_token) return refusal("The project or rules changed since the audit, so the reviewed plan no longer matches; audit again and review the new plan.", { planToken: plan.planToken });
          if (plan.invalidPlanReasons.length) return refusal(`Invalid structure plan: ${plan.invalidPlanReasons.join("; ")}`, { invalidPlanReasons: plan.invalidPlanReasons });
          if (plan.truncated) return refusal(`The project walk was truncated at ${MAX_STRUCTURE_AUDIT_ITEMS} items or ${MAX_TREE_DEPTH} levels, so the plan cannot be applied safely.`);
          if (plan.ambiguousTargets.length) return refusal(`Target bin path(s) are ambiguous: ${plan.ambiguousTargets.map((target) => target.ambiguous_at).join(", ")}. Rename the duplicate bins, then audit again.`, { ambiguousTargets: plan.ambiguousTargets });
          if (!plan.moves.length && !plan.binsToCreate.length && !plan.renames.length && !plan.removals.length) {
            return { success: true, data: { applied: false, outcome: "verified", detail: "No moves, bins, renames, or removals were planned.", createdBins: [], moves: [], verifiedCount: 0, attempted: 0, removals: [], removedCount: 0, removalsAttempted: 0, renames: [], renamedCount: 0, renamesAttempted: 0 } };
          }

          const result = await sendCommand(projectStructureApplyScript(plan), { ...bridgeOptions, mutationOnTimeout: true });
          if (!result.success) return result;
          const data = result.data as { createdBins?: unknown[]; moves?: Array<{ status?: string }>; verifiedCount?: number; attempted?: number; removedCount?: number; removalsAttempted?: number; renamedCount?: number; renamesAttempted?: number };
          const attempted = data.attempted ?? plan.moves.length;
          const verifiedCount = data.verifiedCount ?? 0;
          const removalsAttempted = data.removalsAttempted ?? plan.removals.length;
          const removedCount = data.removedCount ?? 0;
          const renamesAttempted = data.renamesAttempted ?? plan.renames.length;
          const renamedCount = data.renamedCount ?? 0;
          const done = verifiedCount + removedCount + renamedCount;
          const planned = attempted + removalsAttempted + renamesAttempted;
          const outcome = done === planned ? "verified" : done > 0 ? "partial" : "failed";
          const summary = {
            applied: done > 0 || (data.createdBins?.length ?? 0) > 0,
            outcome,
            ...data,
            movesRemaining: plan.movesTotal - plan.moves.length,
            removalsRemaining: plan.removalsTotal - plan.removals.length,
            renamesRemaining: plan.renamesTotal - plan.renames.length,
          };
          if (outcome === "verified") return { success: true, data: summary };
          const parts = [`${verifiedCount} of ${attempted} planned move(s)`];
          if (removalsAttempted) parts.push(`${removedCount} of ${removalsAttempted} empty-bin removal(s)`);
          if (renamesAttempted) parts.push(`${renamedCount} of ${renamesAttempted} rename(s)`);
          return { success: false, error: `${parts.join(", ")} verified${outcome === "partial" ? "; the project changed" : ""}. See data.moves, data.removals, and data.renames for per-item reasons; audit again before retrying.`, data: summary };
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      },
    },
  };
}
