import { describe, expect, it, vi } from "vitest";
import { getProjectIntakeTools, projectIntakeCaptureScript } from "../../src/tools/project-intake.js";

const template = {
  schemaVersion: 1,
  id: "facility-intake",
  version: "1",
  requiredBins: [{ name: "Incoming" }],
  allowedExtensions: ["mov"],
  allowedFrameRates: [],
  proxyPolicy: "ignore",
  approvedPathPrefixes: [],
  requiredEvidence: [],
  organizationRules: [{ id: "camera", destinationBinName: "Camera", match: { extensions: ["mov"] } }],
};

describe("preview_project_intake tool", () => {
  it("returns a bounded read-only report without requiring an active sequence", async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: true,
      data: {
        project: { id: "project-1", name: "Feature" },
        items: [
          { id: "bin-1", name: "Incoming", type: "bin", parentId: "root", treePath: "Incoming" },
          { id: "clip-1", name: "A001.mov", type: "clip", parentId: "bin-1", mediaPath: "D:/Secret/A001.mov", offline: false },
        ],
        truncated: false,
        unavailableEvidence: [],
      },
    }));
    const tools = getProjectIntakeTools({}, { captureSnapshot });
    const result = await tools.preview_project_intake.handler({ template, max_items: 25 });

    expect(captureSnapshot).toHaveBeenCalledWith(25);
    expect(result).toMatchObject({
      success: true,
      data: {
        applied: false,
        capture: { pathDisclosure: "redacted" },
        organizationPlan: { applied: false, proposedMoves: [{ projectItemId: "clip-1" }] },
      },
    });
    expect(JSON.stringify(result)).not.toContain("D:/Secret");
  });

  it("does not abort the preview when one host item has malformed frame-rate evidence", async () => {
    const captureSnapshot = vi.fn(async () => ({
      success: true,
      data: {
        project: { id: "project-1", name: "Feature" },
        items: [{ id: "clip-1", name: "A001.mov", type: "clip", frameRate: null }],
        truncated: false,
        unavailableEvidence: [],
      },
    }));
    const tools = getProjectIntakeTools({}, { captureSnapshot });
    const result = await tools.preview_project_intake.handler({
      template: { ...template, allowedFrameRates: [29.97], requiredEvidence: ["frame_rate"] },
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        status: "incomplete",
        findings: expect.arrayContaining([
          expect.objectContaining({ code: "FRAME_RATE_UNSUPPORTED", itemId: "clip-1" }),
        ]),
      },
    });
  });

  it("propagates bridge failures and rejects invalid bounds before capture", async () => {
    const captureSnapshot = vi.fn(async () => ({ success: false, error: "No project is open" }));
    const tools = getProjectIntakeTools({}, { captureSnapshot });

    await expect(tools.preview_project_intake.handler({ template })).resolves.toEqual({ success: false, error: "No project is open" });
    await expect(tools.preview_project_intake.handler({ template, max_items: 0 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("max_items") });
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("builds a read-only bounded ExtendScript capture", () => {
    const script = projectIntakeCaptureScript(17);
    expect(script).toContain("var maximumItems = 17");
    expect(script).toContain("No project is open");
    expect(script).toContain("items.length >= maximumItems");
    expect(script).not.toContain("activeSequence");
    expect(script).not.toMatch(/\.moveBin\(|\.createBin\(|\.deleteBin\(/);
  });
});
