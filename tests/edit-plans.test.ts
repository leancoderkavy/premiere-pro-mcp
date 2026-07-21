import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/bridge/file-bridge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/bridge/file-bridge.js")>();
  return { ...original, sendCommand: vi.fn(async () => ({ success: true, data: { applied: true } })) };
});

import { sendCommand } from "../src/bridge/file-bridge.js";
import { confirmationToken, getEditPlanTools, validateEditPlan } from "../src/tools/edit-plans.js";

const plan = { operations: [{ type: "insert_clip" as const, item_id: "clip-1", start_seconds: 2 }] };

describe("edit plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews without contacting Premiere", async () => {
    const tools = getEditPlanTools({}, { capabilities: { capabilities: new Set(["inspect"]), source: "explicit" }, operationIdFactory: () => "preview-1" });
    const result = await tools.preview_edit_plan.handler({ plan });
    expect(result.data).toMatchObject({ operationId: "preview-1", applied: false, confirmationToken: confirmationToken(plan) });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("requires the edit capability before apply", async () => {
    const tools = getEditPlanTools({}, { capabilities: { capabilities: new Set(["inspect"]), source: "explicit" }, auditSink: vi.fn(), operationIdFactory: () => "apply-1" });
    await expect(tools.apply_edit_plan.handler({ plan, confirmation_token: confirmationToken(plan) })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects changed plans and applies an exact previewed plan in one command", async () => {
    const auditSink = vi.fn();
    const tools = getEditPlanTools({}, { capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" }, auditSink, operationIdFactory: () => "apply-2" });
    await expect(tools.apply_edit_plan.handler({ plan: { ...plan, sequence_id: "different" }, confirmation_token: confirmationToken(plan) })).rejects.toThrow("does not match");
    const result = await tools.apply_edit_plan.handler({ plan, confirmation_token: confirmationToken(plan) });
    expect(result).toMatchObject({ success: true, data: { applied: true, operationId: "apply-2" } });
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(auditSink).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported and unsafe operations", () => {
    expect(() => validateEditPlan({ operations: [{ type: "raw_script", code: "app.quit()" }] })).toThrow("unsupported type");
    expect(() => validateEditPlan({ operations: [{ type: "insert_clip", item_id: "x", start_seconds: -1 }] })).toThrow("non-negative");
  });
});
