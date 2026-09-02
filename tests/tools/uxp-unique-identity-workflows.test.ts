import { describe, expect, it, vi } from "vitest";
import { getUxpUniqueIdentityWorkflowTools } from "../../src/tools/uxp-unique-identity-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public documented UXP unique serializable identity tool", () => {
  it("publishes an exclusive bounded locator schema and maps only explicit selectors", async () => {
    const request = vi.fn().mockResolvedValue({ projectGuid: "project-1" });
    const tool = getUxpUniqueIdentityWorkflowTools({ request } as unknown as UxpWebSocketBridge)
      .inspect_unique_object_identity_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        project_item_id: { minLength: 1, maxLength: 512 },
        sequence_guid: { minLength: 1, maxLength: 512 },
        expected_project_guid: { minLength: 1, maxLength: 512 },
        expected_unique_id: { minLength: 1, maxLength: 512 },
      },
      oneOf: [{ required: ["project_item_id"] }, { required: ["sequence_guid"] }],
    });
    expect(tool.description).toContain("does not expose paths");
    expect(tool.operationalCapability).toMatchObject({
      backend: "UXP", minimumPremiereVersion: "26.3", hostVerificationRequired: true,
    });

    await tool.handler({ project_item_id: "item-1", expected_project_guid: "project-1", expected_unique_id: "unique-1" });
    await tool.handler({ sequence_guid: "sequence-1" });
    expect(request).toHaveBeenNthCalledWith(1, "object.uniqueIdentity.inspect", {
      projectItemId: "item-1", expectedProjectGuid: "project-1", expectedUniqueId: "unique-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "object.uniqueIdentity.inspect", { sequenceGuid: "sequence-1" });
  });
});
