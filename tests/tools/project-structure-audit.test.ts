import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  evaluateProjectStructure,
  getProjectStructureAuditTools,
  matchesNameGlob,
  MAX_STRUCTURE_MOVES,
  projectStructureApplyScript,
  projectStructureCaptureScript,
  validateStructureRules,
} from "../../src/tools/project-structure-audit.js";
import { getProjectIntakeTools } from "../../src/tools/project-intake.js";
import { capabilitiesForToolInvocation, isToolPermitted, resolveCapabilities } from "../../src/security/capabilities.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/project-structure", timeoutMs: 5000 };
type Result = { success: boolean; error?: string; data?: Record<string, any> };
beforeEach(() => vi.clearAllMocks());

type Node = { nodeId: string; name: string; type: number; children?: { numItems: number; [i: number]: Node }; parent?: Node; [key: string]: unknown };

/** Fake Premiere project tree that evaluates the generated ExtendScript. */
function fakeProject(options: { moveNoop?: string[]; createBinFails?: boolean; createInRoot?: boolean; deleteNoop?: string[]; renameNoop?: string[] } = {}) {
  let counter = 0;
  const kids = (bin: Node) => bin.children!;
  const remove = (bin: Node, child: Node) => {
    const list: Node[] = [];
    for (let i = 0; i < kids(bin).numItems; i++) if (kids(bin)[i] !== child) list.push(kids(bin)[i]);
    for (let i = 0; i < kids(bin).numItems; i++) delete kids(bin)[i];
    list.forEach((node, i) => { kids(bin)[i] = node; });
    kids(bin).numItems = list.length;
  };
  const add = (bin: Node, child: Node) => { kids(bin)[kids(bin).numItems] = child; kids(bin).numItems++; child.parent = bin; };
  const movable = (node: Node) => {
    if (options.renameNoop?.includes(node.nodeId)) {
      const fixed = node.name;
      Object.defineProperty(node, "name", { get: () => fixed, set: () => undefined, enumerable: true });
    }
    node.moveBin = (target: Node) => {
      if (options.moveNoop?.includes(node.nodeId)) return;
      remove(node.parent!, node);
      add(target, node);
    };
    return node;
  };
  const bin = (nodeId: string, name: string): Node => {
    const node = movable({ nodeId, name, type: 2, children: { numItems: 0 } });
    node.deleteBin = () => {
      if (options.deleteNoop?.includes(node.nodeId)) return;
      remove(node.parent!, node);
    };
    node.createBin = (childName: string) => {
      if (options.createBinFails) return null;
      const created = bin(`new-${++counter}`, childName);
      add(options.createInRoot ? root : node, created);
      return created;
    };
    return node;
  };
  const clip = (nodeId: string, name: string, mediaPath?: string): Node => movable({ nodeId, name, type: 1, getMediaPath: () => mediaPath ?? "" });
  const sequence = (nodeId: string, name: string): Node => movable({ nodeId, name, type: 1, isSequence: () => true, getMediaPath: () => "" });
  const root = bin("root", "Project");
  mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { rootItem: root, name: "Feature.prproj", documentID: "doc-1", sequences: { numSequences: 0 } } },
  }))));
  const pathOf = (node: Node): string => {
    const names: string[] = [];
    for (let current = node.parent; current && current !== root; current = current.parent) names.unshift(current.name);
    return names.join("/") || "/";
  };
  return { root, bin, clip, sequence, add, pathOf };
}

function standardProject(options: Parameters<typeof fakeProject>[0] = {}) {
  const p = fakeProject(options);
  const footage = p.bin("footage", "Footage");
  p.add(p.root, footage);
  const a = p.clip("clip-a", "A001.mp4", "/Volumes/Secret/A001.mp4");
  const boom = p.clip("clip-boom", "Boom", "/Volumes/Secret/boom.WAV");
  const edit = p.sequence("seq-1", "Edit v1");
  const inside = p.clip("clip-b", "B001.mp4", "/Volumes/Secret/B001.mp4");
  p.add(p.root, a);
  p.add(p.root, boom);
  p.add(p.root, edit);
  p.add(footage, inside);
  return { ...p, footage, a, boom, edit, inside };
}

const rules = { extension_bins: { ".mp4": "Footage", ".wav": "Audio/SFX" }, sequences_bin: "Sequences" };
const tools = () => getProjectStructureAuditTools(bridgeOptions);

describe("audit_project_structure audit mode", () => {
  it("reports violations with node IDs and proposed targets without changing Premiere", async () => {
    const p = standardProject();
    const result = await tools().audit_project_structure.handler({ rules }) as Result;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ applied: false, outcome: "audited", compliant: false, applyReady: true, truncated: false, binsToCreate: ["Audio/SFX", "Sequences"] });
    expect(result.data!.moves).toEqual([
      expect.objectContaining({ item_id: "clip-a", from_parent_id: "root", target_bin_path: "Footage", rule: "extension_bins" }),
      expect.objectContaining({ item_id: "clip-boom", target_bin_path: "Audio/SFX" }),
      expect.objectContaining({ item_id: "seq-1", target_bin_path: "Sequences", rule: "sequences_bin" }),
    ]);
    expect(result.data!.planToken).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result.data)).not.toContain("/Volumes/Secret");
    expect(p.pathOf(p.a)).toBe("/");
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("reports root-name, depth, and empty-bin findings as report-only", async () => {
    const p = fakeProject();
    const deep = p.bin("b1", "Footage");
    const deeper = p.bin("b2", "Day 1");
    const deepest = p.bin("b3", "Cam A");
    p.add(p.root, deep); p.add(deep, deeper); p.add(deeper, deepest);
    p.add(p.root, p.bin("junk", "Untitled Bin"));
    const result = await tools().audit_project_structure.handler({ rules: { allowed_root_names: ["Foot*", "Seq?ences"], max_depth: 2, forbid_empty_bins: true } }) as Result;
    expect(result.data!.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_id: "junk", rule: "allowed_root_names" }),
      expect.objectContaining({ item_id: "b3", rule: "max_depth", current_bin_path: "Footage/Day 1" }),
      expect.objectContaining({ item_id: "b3", rule: "forbid_empty_bins" }),
      expect.objectContaining({ item_id: "junk", rule: "forbid_empty_bins" }),
    ]));
    expect(result.data!.moves).toEqual([]);
    expect(result.data!.applyReady).toBe(false);
  });

  it("treats items nested inside the target bin as compliant", async () => {
    const p = fakeProject();
    const footage = p.bin("f", "Footage");
    const day = p.bin("d", "Day 1");
    p.add(p.root, footage); p.add(footage, day); p.add(day, p.clip("c", "A.mp4", "/x/A.mp4"));
    const result = await tools().audit_project_structure.handler({ rules: { extension_bins: { ".MP4": "Footage" } } }) as Result;
    expect(result.data).toMatchObject({ compliant: true, violationsTotal: 0, moves: [] });
  });

  it("reports truncation and refuses apply on a truncated walk", async () => {
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, name: `C${i}.mp4`, kind: "clip", parentId: "root", extension: ".mp4" }));
    const captureSnapshot = vi.fn(async () => ({ success: true, data: { project: { id: "doc", name: "P" }, items, truncated: true, skippedReferences: 0 } }));
    const truncatedTools = getProjectStructureAuditTools(bridgeOptions, { captureSnapshot });
    const audit = await truncatedTools.audit_project_structure.handler({ rules: { extension_bins: { ".mp4": "Footage" } } }) as Result;
    expect(audit.data).toMatchObject({ truncated: true, applyReady: false });
    expect(audit.data!.limitations.join(" ")).toContain("incomplete");
    const applied = await truncatedTools.audit_project_structure.handler({ rules: { extension_bins: { ".mp4": "Footage" } }, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(applied).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(applied.error).toContain("truncated");
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("caps planned moves and reports the remainder", () => {
    const items = Array.from({ length: MAX_STRUCTURE_MOVES + 5 }, (_, i) => ({ id: `c${i}`, name: `C${i}.mp4`, kind: "clip", parentId: "root", extension: ".mp4" }));
    const plan = evaluateProjectStructure({ project: { id: "doc", name: "P" }, items, truncated: false }, { extension_bins: { ".mp4": "Footage" } });
    expect(plan.moves).toHaveLength(MAX_STRUCTURE_MOVES);
    expect(plan).toMatchObject({ movesTotal: MAX_STRUCTURE_MOVES + 5, movesTruncated: true, violationsTotal: MAX_STRUCTURE_MOVES + 5 });
  });

  it("the capture script stops at the item limit and flags truncation", async () => {
    const p = fakeProject();
    for (let i = 0; i < 4; i++) p.add(p.root, p.clip(`c${i}`, `C${i}.mp4`));
    mockedSendCommand.mockClear();
    const captured = await sendCommand(projectStructureCaptureScript(2), bridgeOptions) as Result;
    expect(captured.data).toMatchObject({ truncated: true });
    expect(captured.data!.items).toHaveLength(2);
  });
});

describe("audit_project_structure apply mode", () => {
  it("creates missing bins, moves planned items, and verifies every parent", async () => {
    const p = standardProject();
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ applied: true, outcome: "verified", verifiedCount: 3, attempted: 3, movesRemaining: 0 });
    expect(result.data!.createdBins.map((b: { path: string }) => b.path)).toEqual(["Audio", "Audio/SFX", "Sequences"]);
    expect(result.data!.moves.every((m: { status: string }) => m.status === "verified")).toBe(true);
    expect(p.pathOf(p.a)).toBe("Footage");
    expect(p.pathOf(p.boom)).toBe("Audio/SFX");
    expect(p.pathOf(p.edit)).toBe("Sequences");
    expect(p.pathOf(p.inside)).toBe("Footage");
    const again = await tools().audit_project_structure.handler({ rules }) as Result;
    expect(again.data).toMatchObject({ compliant: true, moves: [] });
  });

  it("moves a bin created in the root under its requested parent", async () => {
    const p = standardProject({ createInRoot: true });
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.data).toMatchObject({ outcome: "verified" });
    expect(p.pathOf(p.boom)).toBe("Audio/SFX");
  });

  it("reports partial when one move does not read back", async () => {
    const p = standardProject({ moveNoop: ["clip-boom"] });
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("2 of 3");
    expect(result.data).toMatchObject({ outcome: "partial", verifiedCount: 2 });
    expect(result.data!.moves).toContainEqual(expect.objectContaining({ item_id: "clip-boom", status: "failed", reason: "parent_readback_mismatch" }));
    expect(p.pathOf(p.boom)).toBe("/");
  });

  it("reports failure without moving anything when bin creation fails", async () => {
    const p = standardProject({ createBinFails: true });
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("did not create bin");
    expect(p.pathOf(p.a)).toBe("/");
  });

  it("refuses when a target path is ambiguous, before any mutation", async () => {
    const p = standardProject();
    p.add(p.root, p.bin("footage-2", "Footage"));
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    expect(audit.data!.ambiguousTargets).toEqual([{ target_bin_path: "Footage", ambiguous_at: "Footage" }]);
    expect(audit.data!.violations).toContainEqual(expect.objectContaining({ item_id: "clip-a", target_ambiguous: true }));
    expect(audit.data!.applyReady).toBe(false);
    mockedSendCommand.mockClear();
    const result = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(result.error).toContain("ambiguous");
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(p.pathOf(p.boom)).toBe("/");
  });

  it("the apply script itself refuses a duplicate bin name that appeared after planning", async () => {
    const p = standardProject();
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, rules);
    expect(plan.planToken).toBe(audit.data!.planToken);
    p.add(p.root, p.bin("footage-2", "Footage"));
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(result).toMatchObject({ success: false, data: { mutationOutcome: "not_applied", ambiguousTarget: "Footage" } });
    expect(p.pathOf(p.a)).toBe("/");
  });

  it("refuses a stale or missing plan_token", async () => {
    const p = standardProject();
    const audit = await tools().audit_project_structure.handler({ rules }) as Result;
    p.add(p.root, p.clip("late", "Late.mp4", "/x/Late.mp4"));
    const stale = await tools().audit_project_structure.handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(stale).toMatchObject({ success: false, data: { mutationOutcome: "not_applied" } });
    expect(stale.error).toContain("changed since the audit");
    expect(p.pathOf(p.a)).toBe("/");
    await expect(tools().audit_project_structure.handler({ rules, apply: true })).resolves.toMatchObject({ success: false, error: expect.stringContaining("requires plan_token") });
    await expect(tools().audit_project_structure.handler({ rules: { ...rules, sequences_bin: "Edits" }, apply: true, plan_token: audit.data!.planToken }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("changed since the audit") });
  });

  it("skips an item that moved after the plan was captured", async () => {
    const p = standardProject();
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, rules);
    (p.a.moveBin as (bin: Node) => void)(p.footage);
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(result.data!.moves).toContainEqual(expect.objectContaining({ item_id: "clip-a", status: "failed", reason: "moved_since_audit" }));
    expect(result.data!.verifiedCount).toBe(2);
  });

  it("escapes names and IDs with quotes and backslashes in the generated script", async () => {
    const p = fakeProject();
    const hostile = p.clip('id"\\x', 'Take "1" \\ end.mp4', "/x/take.mp4");
    p.add(p.root, hostile);
    const hostileRules = { extension_bins: { ".mp4": 'Media "A"\\B' } };
    const audit = await tools().audit_project_structure.handler({ rules: hostileRules }) as Result;
    expect(audit.data!.moves[0]).toMatchObject({ item_id: 'id"\\x', item_name: 'Take "1" \\ end.mp4' });
    const plan = evaluateProjectStructure({ project: { id: "doc-1", name: "P" }, items: [{ id: 'id"\\x', name: 'Take "1" \\ end.mp4', kind: "clip", parentId: "root", extension: ".mp4" }], truncated: false }, hostileRules);
    const script = projectStructureApplyScript(plan);
    expect(script).toContain('"Media \\"A\\"\\\\B"');
    expect(script).toContain('itemId:"id\\"\\\\x"');
    const result = await tools().audit_project_structure.handler({ rules: hostileRules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.data).toMatchObject({ outcome: "verified" });
    expect(p.pathOf(hostile)).toBe('Media "A"\\B');
  });

  it("reports no-op apply as verified without sending an apply script", async () => {
    const p = fakeProject();
    p.add(p.root, p.bin("f", "Footage"));
    const compliantRules = { extension_bins: { ".mp4": "Footage" } };
    const audit = await tools().audit_project_structure.handler({ rules: compliantRules }) as Result;
    mockedSendCommand.mockClear();
    await expect(tools().audit_project_structure.handler({ rules: compliantRules, apply: true, plan_token: audit.data!.planToken }))
      .resolves.toMatchObject({ success: true, data: { outcome: "verified", attempted: 0 } });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("passes host failures through", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "No project is open" });
    await expect(tools().audit_project_structure.handler({ rules })).resolves.toEqual({ success: false, error: "No project is open" });
  });
});

describe("audit_project_structure validation and authority", () => {
  it.each([
    [undefined, /rules must be an object/],
    [{}, /at least one/],
    [{ bogus: true }, /unknown key/],
    [{ allowed_root_names: [] }, /non-empty array/],
    [{ allowed_root_names: Array(201).fill("a") }, /at most 200/],
    [{ allowed_root_names: ["x".repeat(256)] }, /at most 255/],
    [{ allowed_root_names: ["bad\nname"] }, /control characters/],
    [{ extension_bins: { wav: "Audio" } }, /must look like/],
    [{ extension_bins: { ".wav": "Audio", ".WAV": "Sfx" } }, /more than once/],
    [{ extension_bins: { ".wav": "/Audio" } }, /segment 1/],
    [{ extension_bins: { ".wav": "Audio//SFX" } }, /segment 2/],
    [{ extension_bins: {} }, /at least one extension/],
    [{ sequences_bin: "" }, /non-empty bin path/],
    [{ max_depth: 0 }, /max_depth/],
    [{ max_depth: 1, sequences_bin: "Edit/Sequences" }, /deeper than rules.max_depth/],
    [{ forbid_empty_bins: "yes" }, /boolean/],
  ])("rejects %j", (input, message) => {
    expect(() => validateStructureRules(input)).toThrow(message);
  });

  it("handler returns validation errors without contacting Premiere", async () => {
    await expect(tools().audit_project_structure.handler({ rules: { bogus: 1 } })).resolves.toMatchObject({ success: false, error: expect.stringContaining("unknown key") });
    await expect(tools().audit_project_structure.handler({ rules, apply: "yes" })).resolves.toMatchObject({ success: false, error: "apply must be a boolean" });
    await expect(tools().audit_project_structure.handler({ rules, plan_token: "a".repeat(64) })).resolves.toMatchObject({ success: false, error: expect.stringContaining("only accepted with apply") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("rejects a malformed snapshot", () => {
    expect(() => evaluateProjectStructure({ items: "x" }, rules)).toThrow(/invalid project-structure snapshot/);
  });

  it("matches simple globs", () => {
    expect(matchesNameGlob("Footage", "Foot*")).toBe(true);
    expect(matchesNameGlob("Sequences", "Seq?ences")).toBe(true);
    expect(matchesNameGlob("footage", "Foot*")).toBe(false);
    expect(matchesNameGlob("A-B-C", "*B*")).toBe(true);
    expect(matchesNameGlob("Audio", "Aud")).toBe(false);
  });

  it("requires edit authority only for apply", () => {
    expect(capabilitiesForToolInvocation("audit_project_structure", { rules })).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("audit_project_structure", { rules, apply: true })).toEqual(["inspect", "edit"]);
    expect(isToolPermitted("audit_project_structure", resolveCapabilities("inspect"))).toBe(true);
  });

  it("is registered through the project-intake module", () => {
    expect(Object.keys(getProjectIntakeTools(bridgeOptions))).toContain("audit_project_structure");
  });
});

describe("audit_project_structure target_tree, rename, and remove_empty", () => {
  function tidyProject(options: Parameters<typeof fakeProject>[0] = {}) {
    const p = fakeProject(options);
    const sequences = p.bin("seqs", "00 SEQUENCES");
    const roughcuts = p.bin("rc", "03 ROUGHCUTS");
    const old = p.bin("zold", "zOLD");
    const empty = p.bin("empty", "Untitled Bin");
    const emptyKept = p.bin("kept", "02 LINES");
    const stray = p.sequence("seq-stray", "Cut v3");
    const stems = p.sequence("seq-stems", "Music stems");
    const music = p.bin("music", "comps");
    p.add(p.root, sequences); p.add(sequences, roughcuts); p.add(roughcuts, old); p.add(root(p), empty); p.add(root(p), emptyKept);
    p.add(p.root, stray); p.add(p.root, music); p.add(music, stems);
    return { ...p, sequences, roughcuts, old, empty, emptyKept, stray, stems, music };
  }
  const root = (p: ReturnType<typeof fakeProject>) => p.root;
  const tidyRules = {
    target_tree: [
      { bin: "00 SEQUENCES/03 ROUGHCUTS", items: ["seq-stray", "zold"] },
      { bin: "00 SEQUENCES/02 LINES", items: ["kept"] },
      { bin: "00 SEQUENCES/01 STRINGOUTS" },
      { bin: "02 AUDIO/02 MUSIC", items: ["music"] },
    ],
    rename: [{ item_id: "seq-stems", name: "MUSIC STEMS" }, { item_id: "rc", name: "03 ROUGHCUTS" }],
    remove_empty: true,
  };

  it("plans explicit placements, renames, and removals with a token, without changing Premiere", async () => {
    const p = tidyProject();
    const audit = await tools().audit_project_structure.handler({ rules: tidyRules }) as Result;
    expect(audit.success).toBe(true);
    expect(audit.data).toMatchObject({ applied: false, applyReady: true, compliant: false, unresolvedItemIds: [] });
    expect(audit.data!.moves).toEqual([
      expect.objectContaining({ item_id: "seq-stray", target_bin_path: "00 SEQUENCES/03 ROUGHCUTS", rule: "target_tree" }),
      expect.objectContaining({ item_id: "kept", item_kind: "bin", target_bin_path: "00 SEQUENCES/02 LINES", rule: "target_tree" }),
      expect.objectContaining({ item_id: "music", item_kind: "bin", target_bin_path: "02 AUDIO/02 MUSIC", rule: "target_tree" }),
    ]);
    expect(audit.data!.targetBins).toEqual(["00 SEQUENCES/03 ROUGHCUTS", "00 SEQUENCES/02 LINES", "00 SEQUENCES/01 STRINGOUTS", "02 AUDIO/02 MUSIC"]);
    expect(audit.data!.binsToCreate).toEqual(["00 SEQUENCES/02 LINES", "02 AUDIO/02 MUSIC", "00 SEQUENCES/01 STRINGOUTS"]);
    // rc already has the requested name: no-op, not planned.
    expect(audit.data!.renames).toEqual([{ item_id: "seq-stems", item_kind: "sequence", from_name: "Music stems", to_name: "MUSIC STEMS" }]);
    // zOLD is empty but is placed by target_tree; 02 LINES is empty but is a target path and placed; Untitled Bin goes.
    expect(audit.data!.removals).toEqual([{ item_id: "empty", item_name: "Untitled Bin", bin_path: "Untitled Bin", parent_id: "root" }]);
    expect(audit.data!.violations).toContainEqual(expect.objectContaining({ item_id: "empty", rule: "remove_empty" }));
    expect(audit.data!.violations).toContainEqual(expect.objectContaining({ item_id: "seq-stems", rule: "rename" }));
    expect(p.pathOf(p.stray)).toBe("/");
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("applies the whole tidy in one call with readback and re-audits compliant", async () => {
    const p = tidyProject();
    const audit = await tools().audit_project_structure.handler({ rules: tidyRules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules: tidyRules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ applied: true, outcome: "verified", verifiedCount: 3, attempted: 3, removedCount: 1, removalsAttempted: 1, renamedCount: 1, renamesAttempted: 1, movesRemaining: 0, removalsRemaining: 0, renamesRemaining: 0 });
    expect(result.data!.createdBins.map((b: { path: string }) => b.path)).toEqual(["00 SEQUENCES/02 LINES", "02 AUDIO", "02 AUDIO/02 MUSIC", "00 SEQUENCES/01 STRINGOUTS"]);
    expect(p.pathOf(p.stray)).toBe("00 SEQUENCES/03 ROUGHCUTS");
    expect(p.pathOf(p.emptyKept)).toBe("00 SEQUENCES/02 LINES");
    expect(p.pathOf(p.music)).toBe("02 AUDIO/02 MUSIC");
    expect(p.pathOf(p.stems)).toBe("02 AUDIO/02 MUSIC/comps");
    expect(p.stems.name).toBe("MUSIC STEMS");
    expect(p.empty.parent).toBe(p.root);
    expect(Array.from({ length: p.root.children!.numItems }, (_, i) => p.root.children![i].nodeId)).not.toContain("empty");
    const again = await tools().audit_project_structure.handler({ rules: tidyRules }) as Result;
    expect(again.data).toMatchObject({ compliant: true, moves: [], renames: [], removals: [], binsToCreate: [], applyReady: false });
  });

  it("reports unresolved node IDs and refuses to move a bin into itself", async () => {
    const p = tidyProject();
    const audit = await tools().audit_project_structure.handler({ rules: { target_tree: [{ bin: "00 SEQUENCES/03 ROUGHCUTS", items: ["ghost", "seqs"] }], rename: [{ item_id: "nobody", name: "X" }] } }) as Result;
    expect(audit.data).toMatchObject({ unresolvedItemIds: ["ghost", "nobody"], moves: [], applyReady: false });
    expect(audit.data!.violations).toContainEqual(expect.objectContaining({ item_id: "seqs", rule: "target_tree", detail: expect.stringContaining("nested inside it") }));
    expect(audit.data!.limitations.join(" ")).toContain("2 node ID(s)");
    expect(p.pathOf(p.sequences)).toBe("/");
  });

  it("creates target_tree bins with no items and applies them even without moves", async () => {
    const p = fakeProject();
    const rulesOnlyBins = { target_tree: [{ bin: "04 TURNOVER/AAF" }] };
    const audit = await tools().audit_project_structure.handler({ rules: rulesOnlyBins }) as Result;
    expect(audit.data).toMatchObject({ compliant: false, applyReady: true, binsToCreate: ["04 TURNOVER/AAF"], moves: [] });
    const result = await tools().audit_project_structure.handler({ rules: rulesOnlyBins, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.data).toMatchObject({ outcome: "verified", applied: true, attempted: 0 });
    expect(result.data!.createdBins.map((b: { path: string }) => b.path)).toEqual(["04 TURNOVER", "04 TURNOVER/AAF"]);
    expect(p.root.children![0].name).toBe("04 TURNOVER");
  });

  it("skips a bin that is no longer empty at apply time and reports partial", async () => {
    const p = tidyProject();
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, { remove_empty: true });
    expect(plan.removals.map((r) => r.item_id).sort()).toEqual(["empty", "kept", "zold"]);
    p.add(p.empty, p.clip("late", "Late.mp4", "/x/Late.mp4"));
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(result.data!.removals).toContainEqual(expect.objectContaining({ item_id: "empty", status: "failed", reason: "not_empty", childCount: 1 }));
    expect(result.data!.removedCount).toBe(2);
    expect(p.empty.parent).toBe(p.root);
  });

  it("reports readback mismatches for deletes and renames through the handler", async () => {
    const p = tidyProject({ deleteNoop: ["empty"], renameNoop: ["seq-stems"] });
    const partialRules = { rename: [{ item_id: "seq-stems", name: "MUSIC STEMS" }], remove_empty: true, target_tree: [{ bin: "00 SEQUENCES/03 ROUGHCUTS", items: ["zold"] }, { bin: "02 LINES" }] };
    const audit = await tools().audit_project_structure.handler({ rules: partialRules }) as Result;
    const result = await tools().audit_project_structure.handler({ rules: partialRules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(result.success).toBe(false);
    expect(result.error).toContain("0 of 1 empty-bin removal(s)");
    expect(result.error).toContain("0 of 1 rename(s)");
    expect(result.data).toMatchObject({ outcome: "failed", removedCount: 0, renamedCount: 0 });
    expect(result.data!.removals[0]).toMatchObject({ item_id: "empty", reason: "parent_readback_mismatch" });
    expect(result.data!.renames[0]).toMatchObject({ item_id: "seq-stems", reason: "name_readback_mismatch", current_name: "Music stems" });
    expect(p.stems.name).toBe("Music stems");
  });

  it("refuses deletion when the empty bin count becomes unreadable", async () => {
    const p = tidyProject();
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, { remove_empty: true });
    const deleteBin = vi.fn();
    p.empty.deleteBin = deleteBin;
    Object.defineProperty(p.empty.children!, "numItems", { get() { throw new Error("unreadable"); } });
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(deleteBin).not.toHaveBeenCalled();
    expect(result.data!.removals).toContainEqual(expect.objectContaining({ item_id: "empty", status: "failed", reason: "children_unreadable" }));
  });

  it("does not verify removal when the parent count becomes unreadable", async () => {
    const p = tidyProject();
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, { remove_empty: true });
    p.empty.deleteBin = () => {
      Object.defineProperty(p.root.children!, "numItems", { get() { throw new Error("unreadable"); } });
    };
    plan.removals = plan.removals.filter(r => r.item_id === "empty");
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(result.data!.removedCount).toBe(0);
    expect(result.data!.removals[0]).toMatchObject({ status: "failed", reason: "parent_readback_unreadable" });
  });

  it("skips a rename when the name changed since the audit", async () => {
    const p = tidyProject();
    const plan = evaluateProjectStructure((await sendCommand(projectStructureCaptureScript(), bridgeOptions)).data, { rename: [{ item_id: "seq-stems", name: "MUSIC STEMS" }] });
    p.stems.name = "Someone else";
    const result = await sendCommand(projectStructureApplyScript(plan), bridgeOptions) as Result;
    expect(result.data!.renames[0]).toMatchObject({ status: "failed", reason: "renamed_since_audit", current_name: "Someone else" });
    expect(p.stems.name).toBe("Someone else");
  });

  it("binds the token to the explicit operations", () => {
    const snapshot = { project: { id: "doc", name: "P" }, items: [
      { id: "b1", name: "A", kind: "bin", parentId: "root", childCount: 0 },
      { id: "c1", name: "C.mp4", kind: "clip", parentId: "root", extension: ".mp4" },
    ], truncated: false };
    const base = evaluateProjectStructure(snapshot, { target_tree: [{ bin: "A", items: ["c1"] }] });
    expect(evaluateProjectStructure(snapshot, { target_tree: [{ bin: "A", items: ["c1"] }] }).planToken).toBe(base.planToken);
    expect(evaluateProjectStructure(snapshot, { target_tree: [{ bin: "A", items: ["c1"] }], remove_empty: true }).planToken).not.toBe(base.planToken);
    expect(evaluateProjectStructure(snapshot, { target_tree: [{ bin: "A", items: ["c1"] }], rename: [{ item_id: "c1", name: "D.mp4" }] }).planToken).not.toBe(base.planToken);
    // A is a target path, so remove_empty leaves it alone even though it is empty.
    expect(evaluateProjectStructure(snapshot, { target_tree: [{ bin: "A", items: ["c1"] }], remove_empty: true }).removals).toEqual([]);
    expect(evaluateProjectStructure(snapshot, { remove_empty: true }).removals).toEqual([expect.objectContaining({ item_id: "b1" })]);
  });

  it("escapes rename and removal strings in the generated script", () => {
    const plan = evaluateProjectStructure({ project: { id: "doc", name: "P" }, items: [
      { id: 'bin"1', name: 'Old "Bin"\\', kind: "bin", parentId: "root", childCount: 0 },
      { id: "s1", name: "Seq", kind: "sequence", parentId: "root" },
    ], truncated: false }, { remove_empty: true, rename: [{ item_id: "s1", name: 'New "Name"\\' }] });
    const script = projectStructureApplyScript(plan);
    expect(script).toContain('itemId:"bin\\"1"');
    expect(script).toContain('toName:"New \\"Name\\"\\\\"');
  });

  it.each([
    [{ target_tree: [] }, /non-empty array/],
    [{ target_tree: [{ bin: "A", items: ["x"], extra: 1 }] }, /unknown key/],
    [{ target_tree: [{ bin: "A/" }] }, /segment 2/],
    [{ target_tree: [{ bin: "A" }, { bin: "A" }] }, /listed more than once/],
    [{ target_tree: [{ bin: "A", items: ["x"] }, { bin: "B", items: ["x"] }] }, /more than one bin/],
    [{ target_tree: [{ bin: "A", items: [""] }] }, /non-empty node ID/],
    [{ target_tree: Array(501).fill({ bin: "A" }) }, /at most 500 bins/],
    [{ target_tree: [{ bin: "A/B" }], max_depth: 1 }, /deeper than rules.max_depth/],
    [{ rename: [] }, /non-empty array/],
    [{ rename: [{ item_id: "a", name: " x" }] }, /leading or trailing/],
    [{ rename: [{ item_id: "a", name: "x/y" }] }, /must not contain/],
    [{ rename: [{ item_id: "a", name: "x" }, { item_id: "a", name: "y" }] }, /renamed more than once/],
    [{ rename: [{ item_id: "a" }] }, /name must be a non-empty string/],
    [{ remove_empty: "yes" }, /must be a boolean/],
  ])("rejects %j", (input, message) => {
    expect(() => validateStructureRules(input)).toThrow(message);
  });

  it("rejects more than the total item cap across bins", () => {
    const tree = Array.from({ length: 3 }, (_, b) => ({ bin: `B${b}`, items: Array.from({ length: 700 }, (_, i) => `b${b}-i${i}`) }));
    expect(() => validateStructureRules({ target_tree: tree })).toThrow(/at most 2000 items/);
  });
});


describe("structure plan placement preflight", () => {
  it.each(["A/New", "A/Existing/New", "A"])("refuses descendant destination %s before mutation", async (destination) => {
    const p = fakeProject();
    const a = p.bin("a", "A");
    p.add(p.root, a);
    p.add(a, p.bin("existing", "Existing"));
    const handler = getProjectStructureAuditTools(bridgeOptions).audit_project_structure.handler;
    const rules = { target_tree: [{ bin: destination, items: ["a"] }] };
    const audit = await handler({ rules }) as Result;
    expect(audit.data!.applyReady).toBe(false);
    const before = mockedSendCommand.mock.calls.length;
    const applied = await handler({ rules, apply: true, plan_token: audit.data!.planToken }) as Result;
    expect(applied).toMatchObject({ success: false, data: { applied: false } });
    expect(mockedSendCommand.mock.calls.length).toBe(before + 1); // capture only
    expect(a.children!.numItems).toBe(1);
    expect(p.pathOf(a)).toBe("/");
  });

  it.each(["A", "A/New"])("rejects relocation of required prefix for %s", async (target) => {
    const p = fakeProject();
    p.add(p.root, p.bin("a", "A"));
    p.add(p.root, p.bin("b", "B"));
    p.add(p.root, p.clip("x", "x.mp4"));
    const handler = getProjectStructureAuditTools(bridgeOptions).audit_project_structure.handler;
    const rules = { target_tree: [{ bin: target, items: ["x"] }, { bin: "B", items: ["a"] }] };
    const audit = await handler({ rules }) as Result;
    expect(audit.data!.invalidPlanReasons.join(" ")).toContain("relocate required target path");
    const before = mockedSendCommand.mock.calls.length;
    expect(await handler({ rules, apply: true, plan_token: audit.data!.planToken })).toMatchObject({ success: false });
    expect(mockedSendCommand.mock.calls.length).toBe(before + 1);
  });

  it.each([false, true])("resolves combined placement once (sequence=%s)", async (sequence) => {
    const p = fakeProject();
    p.add(p.root, sequence ? p.sequence("x", "Edit") : p.clip("x", "x.mp4"));
    const handler = getProjectStructureAuditTools(bridgeOptions).audit_project_structure.handler;
    const base = sequence ? { sequences_bin: "Media" } : { extension_bins: { ".mp4": "Media" } };
    const rules = { ...base, target_tree: [{ bin: "Media/Selects", items: ["x"] }] };
    const audit = await handler({ rules }) as Result;
    expect(audit.data!.moves).toHaveLength(1);
    expect(audit.data!.moves[0].target_bin_path).toBe("Media/Selects");
    expect(await handler({ rules, apply: true, plan_token: audit.data!.planToken })).toMatchObject({ success: true, data: { outcome: "verified" } });
    const conflicting = { ...base, target_tree: [{ bin: "Other", items: ["x"] }] };
    const rejected = await handler({ rules: conflicting }) as Result;
    expect(rejected.data!.applyReady).toBe(false);
    const before = mockedSendCommand.mock.calls.length;
    expect(await handler({ rules: conflicting, apply: true, plan_token: rejected.data!.planToken })).toMatchObject({ success: false });
    expect(mockedSendCommand.mock.calls.length).toBe(before + 1);
  });
});


describe("explicit structure rule safety", () => {
  it("preserves empty configured destinations and removes unrelated empty bins", async () => {
    const p = fakeProject();
    const media = p.bin("media", "Media");
    p.add(p.root, media);
    p.add(media, p.bin("audio", "Audio"));
    p.add(p.root, p.bin("seq", "Sequences"));
    p.add(p.root, p.bin("unused", "Unused"));
    const result = await tools().audit_project_structure.handler({ rules: {
      sequences_bin: "Sequences", extension_bins: { ".wav": "Media/Audio" }, remove_empty: true,
    } }) as Result;
    expect(result.success).toBe(true);
    expect(result.data!.removals.map((item: any) => item.item_id)).toEqual(["unused"]);
  });

  it.each([
    { rename: [{ item_id: "missing", name: "Renamed" }] },
    { target_tree: [{ bin: "Destination", items: ["missing"] }] },
    { target_tree: [{ bin: "Duplicate" }] },
  ])("does not declare unresolved explicit rules compliant: %j", async rules => {
    const p = fakeProject();
    p.add(p.root, p.bin("dest", "Destination"));
    p.add(p.root, p.bin("dup1", "Duplicate"));
    p.add(p.root, p.bin("dup2", "Duplicate"));
    const result = await tools().audit_project_structure.handler({ rules }) as Result;
    expect(result.success).toBe(true);
    expect(result.data!.compliant).toBe(false);
  });
});
