import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/bridge/file-bridge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/bridge/file-bridge.js")>();
  return { ...original, sendCommand: vi.fn(async () => ({ success: true, data: { applied: true } })) };
});

import { sendCommand } from "../src/bridge/file-bridge.js";
import { capabilityForTool } from "../src/security/capabilities.js";
import {
  getSpotWorkflowTools,
  spotWorkflowConfirmationToken,
  validateSpotWorkflowPlan,
} from "../src/tools/spot-workflows.js";
import { annotationsForTool } from "../src/workflows/tool-metadata.js";

const productArgs = {
  sequence_id: "sequence-1",
  asset_item_ids: ["item-a", "item-b"],
};

describe("spot workflow plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advertises previews as inspect-only and the apply route as an edit", () => {
    expect(capabilityForTool("preview_product_spot")).toBe("inspect");
    expect(annotationsForTool("preview_product_spot").readOnlyHint).toBe(true);
    expect(capabilityForTool("apply_spot_workflow_plan")).toBe("edit");
  });

  it("previews the product assembly locally without contacting Premiere", async () => {
    const tools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect"]), source: "explicit" },
      operationIdFactory: () => "preview-1",
    });

    const result = await tools.preview_product_spot.handler(productArgs);

    expect(result).toMatchObject({
      success: true,
      data: {
        operationId: "preview-1",
        applied: false,
        plan: {
          workflow: "product_spot",
          sequence_id: "sequence-1",
          clip_duration_seconds: 4,
          motion_style: "alternate",
          transition: { name: "Cross Dissolve", duration_seconds: 0.5 },
        },
      },
    });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("requires edit authority and the exact preview confirmation before applying", async () => {
    const inspectOnly = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "apply-no-edit",
    });
    const preview = await inspectOnly.preview_product_spot.handler(productArgs);
    const plan = preview.data.plan;

    await expect(inspectOnly.apply_spot_workflow_plan.handler({
      plan,
      confirmation_token: preview.data.confirmationToken,
    })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });

    const tools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "apply-bad-token",
    });
    await expect(tools.apply_spot_workflow_plan.handler({ plan, confirmation_token: "different" })).rejects.toThrow("does not match");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("revalidates the plan and generates a contained, readback-oriented host command", async () => {
    const tools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "apply-1",
    });
    const preview = await tools.preview_motion_graphics_demo.handler({
      sequence_id: "sequence-1",
      asset_item_ids: ["item-a", "item-b", "item-c"],
    });
    const plan = preview.data.plan;

    const result = await tools.apply_spot_workflow_plan.handler({
      plan,
      confirmation_token: spotWorkflowConfirmationToken(plan),
    });

    expect(result).toMatchObject({ success: true, data: { applied: true, operationId: "apply-1" } });
    const script = String(vi.mocked(sendCommand).mock.calls[0]?.[0]);
    expect(script).toContain("Target sequence must be active before applying a spot workflow plan");
    expect(script).toContain("Target video and audio tracks must be empty");
    expect(script).toContain("Project item ID was not found exactly");
    expect(script).toContain("scaleProperty.getValueAtKey");
    expect(script).toContain("__findClip(placed[cutIndex + 1].nodeId)");
    expect(script).toContain("__findQeClipByDomClip(qeTrack, placedInfo.clip)");
    expect(script).toContain("typeof qeClip.addTransition !== \"function\"");
    expect(script).toContain('qeClip.addTransition(transitionQE, true, String(durationFrames), "0", 0.5, false, true)');
    expect(script).toContain("foundAtExpectedCut");
    expect(script).not.toContain("qeTrack.addTransition(");
    expect(script).toContain("renderVerified: false");
    expect(script).not.toContain("importMedia");
    expect(script).not.toContain("createNewSequence");
  });

  it("keeps a MOGRT within an approved workspace and requires filesystem authority at apply time", async () => {
    const args = {
      ...productArgs,
      mogrt_path: "D:/Approved/title.mogrt",
      approved_workspace_path: "D:/Approved",
      title_track_index: 1,
      title_start_seconds: 0,
    };
    const previewTools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect", "edit"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "brand-1",
      fileExists: () => true,
    });
    const preview = await previewTools.preview_brand_spot.handler(args);
    const plan = preview.data.plan;

    await expect(previewTools.apply_spot_workflow_plan.handler({
      plan,
      confirmation_token: preview.data.confirmationToken,
    })).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "filesystem" });
    expect(sendCommand).not.toHaveBeenCalled();

    const applyTools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect", "edit", "filesystem"]), source: "explicit" },
      auditSink: vi.fn(),
      operationIdFactory: () => "brand-2",
      fileExists: (file) => file === "D:/Approved/title.mogrt",
    });
    await applyTools.apply_spot_workflow_plan.handler({
      plan,
      confirmation_token: preview.data.confirmationToken,
    });
    const script = String(vi.mocked(sendCommand).mock.calls[0]?.[0]);
    expect(script).toContain("seq.importMGT");
    expect(script).toContain("MOGRT track-count");
  });

  it("rejects plans that add an unpreviewed MOGRT or point outside the approved workspace", async () => {
    await expect(getSpotWorkflowTools({}, { capabilities: { capabilities: new Set(["inspect"]), source: "explicit" } })
      .preview_brand_spot.handler({
        ...productArgs,
        mogrt_path: "D:/Elsewhere/title.mogrt",
        approved_workspace_path: "D:/Approved",
      })).rejects.toThrow("within approved_workspace_path");

    expect(() => validateSpotWorkflowPlan({
      schema_version: 1,
      workflow: "product_spot",
      sequence_id: "sequence-1",
      asset_item_ids: ["item-a"],
      clip_duration_seconds: 4,
      video_track_index: 0,
      audio_track_index: 0,
      motion_style: "alternate",
      mogrt: {
        path: "D:/Approved/title.mogrt",
        approved_workspace_path: "D:/Approved",
        title_track_index: 1,
        title_start_seconds: 0,
      },
    })).toThrow("only brand_spot");
  });

  it("validates preview inputs before a workflow token is issued", async () => {
    const tools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect"]), source: "explicit" },
      operationIdFactory: () => "invalid-preview",
    });

    await expect(tools.preview_product_spot.handler({ ...productArgs, unexpected: true } as any)).rejects.toThrow("unsupported field");
    await expect(tools.preview_product_spot.handler({ ...productArgs, motion_style: "zoom" } as any)).rejects.toThrow("motion_style");
    await expect(tools.preview_product_spot.handler({ ...productArgs, video_track_index: 33 } as any)).rejects.toThrow("video_track_index");
    await expect(tools.preview_product_spot.handler({ ...productArgs, clip_duration_seconds: 0 } as any)).rejects.toThrow("clip_duration_seconds");
    await expect(tools.preview_product_spot.handler({ sequence_id: "sequence-1", asset_item_ids: [] } as any)).rejects.toThrow("asset_item_ids");
    await expect(tools.preview_brand_spot.handler({
      ...productArgs,
      mogrt_path: "/approved/title.txt",
      approved_workspace_path: "/approved",
    } as any)).rejects.toThrow(".mogrt");
    await expect(tools.preview_brand_spot.handler({
      ...productArgs,
      mogrt_path: "relative/title.mogrt",
      approved_workspace_path: "/approved",
    } as any)).rejects.toThrow("absolute paths");
    await expect(tools.preview_brand_spot.handler({
      ...productArgs,
      mogrt_path: "/approved/title.mogrt",
      approved_workspace_path: "/approved",
      title_track_index: 0,
    } as any)).rejects.toThrow("must differ");
  });

  it("handles portable paths and rejects stale or malformed confirmed plans", async () => {
    const previewTools = getSpotWorkflowTools({}, {
      capabilities: { capabilities: new Set(["inspect", "edit", "filesystem"]), source: "explicit" },
      operationIdFactory: () => "portable-preview",
      fileExists: () => false,
    });
    const preview = await previewTools.preview_brand_spot.handler({
      ...productArgs,
      mogrt_path: "/approved/title.mogrt",
      approved_workspace_path: "/approved",
      transition_name: "none",
      motion_style: "none",
    });
    expect(preview.data.plan.transition).toBeUndefined();
    expect(preview.data.changes.motion).toMatchObject({ skipped: true });
    await expect(previewTools.apply_spot_workflow_plan.handler({
      plan: preview.data.plan,
      confirmation_token: preview.data.confirmationToken,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("no longer exists") });

    expect(() => validateSpotWorkflowPlan({
      schema_version: 2,
      workflow: "product_spot",
    })).toThrow("schema_version");
    expect(() => validateSpotWorkflowPlan({
      schema_version: 1,
      workflow: "not-a-workflow",
    })).toThrow("workflow");
  });
});
