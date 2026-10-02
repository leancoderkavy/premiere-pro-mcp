import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../src/bridge/file-bridge.js";
import { MAX_BRIDGE_SCRIPT_BYTES, validateBridgeScriptSize } from "../src/bridge/script-size.js";
import { getEditPlanTools } from "../src/tools/edit-plans.js";
import type { EditPlanHostBinding } from "../src/tools/edit-plan-token-store.js";

beforeEach(() => vi.mocked(sendCommand).mockReset());
function fixture(binding: EditPlanHostBinding) {
  let issuedBinding = binding;
  const issue = vi.fn((_digest: string, value: EditPlanHostBinding) => { issuedBinding = value; return "fixture-token"; });
  const consume = vi.fn(() => issuedBinding);
  const tools = getEditPlanTools({}, {
    capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" }, auditSink: vi.fn(),
    tokenStore: { issue, consume },
  });
  vi.mocked(sendCommand).mockResolvedValue({ success: true, data: { targetsValidated: true, hostBinding: binding } });
  return { tools, issue, consume };
}
const insertPlan = { operations: [{ type: "insert_clip", item_id: "media", start_seconds: 0 }] };
const insertBinding: EditPlanHostBinding = { version: 1, projectDocumentId: "p", sequenceId: "s", targets: [{ type: "insert_clip", targetId: "media", videoTrackIndex: 0, audioTrackIndex: 0 }] };

describe("bound edit-plan command size preflight", () => {
  it("uses the bridge's UTF-8 byte boundary", () => {
    expect(() => validateBridgeScriptSize("x".repeat(MAX_BRIDGE_SCRIPT_BYTES))).not.toThrow();
    expect(() => validateBridgeScriptSize("x".repeat(MAX_BRIDGE_SCRIPT_BYTES + 1))).toThrow("500KB");
    expect(() => validateBridgeScriptSize("é".repeat(MAX_BRIDGE_SCRIPT_BYTES / 2))).not.toThrow();
    expect(() => validateBridgeScriptSize("é".repeat(MAX_BRIDGE_SCRIPT_BYTES / 2) + "x")).toThrow("500KB");
  });
  it("accepts an exact-limit generated apply command and refuses the next byte before issuing a token", async () => {
    const baseline = fixture(insertBinding);
    await baseline.tools.preview_edit_plan.handler({ plan: insertPlan });
    await baseline.tools.apply_edit_plan.handler({ plan: insertPlan, confirmation_token: "fixture-token" });
    const baselineBytes = Buffer.byteLength(vi.mocked(sendCommand).mock.calls.at(-1)![0], "utf-8");
    const padding = MAX_BRIDGE_SCRIPT_BYTES - baselineBytes;
    expect(padding).toBeGreaterThan(0);
    vi.mocked(sendCommand).mockClear();
    const exact = fixture({ ...insertBinding, projectDocumentId: "p" + "x".repeat(padding) });
    expect(await exact.tools.preview_edit_plan.handler({ plan: insertPlan })).toMatchObject({ success: true });
    expect(exact.issue).toHaveBeenCalledOnce();
    await exact.tools.apply_edit_plan.handler({ plan: insertPlan, confirmation_token: "fixture-token" });
    expect(Buffer.byteLength(vi.mocked(sendCommand).mock.calls.at(-1)![0], "utf-8")).toBe(MAX_BRIDGE_SCRIPT_BYTES);
    vi.mocked(sendCommand).mockClear();
    const over = fixture({ ...insertBinding, projectDocumentId: "p" + "x".repeat(padding + 1) });
    expect(await over.tools.preview_edit_plan.handler({ plan: insertPlan })).toMatchObject({ success: false, error: expect.stringContaining("No confirmation token") });
    expect(over.issue).not.toHaveBeenCalled(); expect(sendCommand).toHaveBeenCalledOnce();
  });
  it("refuses a large valid partner binding without issuing or consuming a token", async () => {
    const clip = { targetId: "clip", sourceProjectItemId: "media", trackType: "video" as const, trackIndex: 0, startTicks: "0", endTicks: "1", inTicks: "0", outTicks: "1" };
    const linkedPartners = Array.from({ length: 256 }, (_, index) => ({ ...clip, targetId: `partner-${index}`, trackType: "audio" as const }));
    const binding: EditPlanHostBinding = { ...insertBinding, targets: Array.from({ length: 100 }, () => ({ type: "remove_clip", ...clip, linkedPartners })) };
    const f = fixture(binding);
    const plan = { operations: Array.from({ length: 100 }, () => ({ type: "remove_clip", node_id: "clip" })) };
    expect(await f.tools.preview_edit_plan.handler({ plan })).toMatchObject({ success: false, error: expect.stringContaining("500KB") });
    expect(f.issue).not.toHaveBeenCalled(); expect(f.consume).not.toHaveBeenCalled(); expect(sendCommand).toHaveBeenCalledOnce();
  });
});
