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
function fakeProject(options: { moveNoop?: string[]; createBinFails?: boolean; createInRoot?: boolean } = {}) {
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
    node.moveBin = (target: Node) => {
      if (options.moveNoop?.includes(node.nodeId)) return;
      remove(node.parent!, node);
      add(target, node);
    };
    return node;
  };
  const bin = (nodeId: string, name: string): Node => {
    const node = movable({ nodeId, name, type: 2, children: { numItems: 0 } });
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
