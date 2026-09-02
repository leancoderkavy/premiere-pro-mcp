import { describe, expect, it, vi } from "vitest";
import { getUxpObjectMaskAuditWorkflowTools } from "../../src/tools/uxp-object-mask-audit-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public documented UXP object-mask audit tool", () => {
  it("publishes a bounded read-only schema and maps only explicit audit selectors", async () => {
    const request = vi.fn().mockResolvedValue({ projectGuid: "project-1" });
    const tool = getUxpObjectMaskAuditWorkflowTools({ request } as unknown as UxpWebSocketBridge).audit_object_masks_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object", additionalProperties: false,
      properties: {
        expected_project_guid: { minLength: 1, maxLength: 512 },
        sequence_ids: { minItems: 1, maxItems: 64, uniqueItems: true, items: { minLength: 1, maxLength: 512 } },
      },
    });
    expect(tool.description).toContain("not mask count");
    expect(tool.operationalCapability).toMatchObject({ backend: "UXP", minimumPremiereVersion: "26.3", hostVerificationRequired: true });

    await tool.handler({ expected_project_guid: "project-1", sequence_ids: ["sequence-b", "sequence-a"] });
    await tool.handler({});
    expect(request).toHaveBeenNthCalledWith(1, "objectMask.audit", {
      expectedProjectGuid: "project-1", sequenceIds: ["sequence-b", "sequence-a"],
    });
    expect(request).toHaveBeenNthCalledWith(2, "objectMask.audit", {});
  });
});
