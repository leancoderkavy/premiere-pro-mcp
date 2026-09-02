import { describe, expect, it, vi } from "vitest";
import { getUxpEffectParameterCatalogWorkflowTools } from "../../src/tools/uxp-effect-parameter-catalog-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public documented UXP effect-parameter catalog tool", () => {
  it("publishes a closed bounded schema and maps only parameter-catalog coordinates", async () => {
    const request = vi.fn().mockResolvedValue({ parameterCount: 1 });
    const tool = getUxpEffectParameterCatalogWorkflowTools({ request } as unknown as UxpWebSocketBridge)
      .inspect_effect_parameter_catalog_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object", additionalProperties: false,
      required: ["media_type", "track_index", "clip_index", "component_index"],
      properties: {
        media_type: { type: "string", enum: ["video", "audio"] },
        track_index: { type: "integer", minimum: 0, maximum: 511 },
        clip_index: { type: "integer", minimum: 0, maximum: 511 },
        component_index: { type: "integer", minimum: 0, maximum: 511 },
        expected_sequence_guid: { minLength: 1, maxLength: 512 },
        expected_component_id: { minLength: 1, maxLength: 512 },
      },
    });
    expect(tool.description).toContain("never raw parameter values");
    expect(tool.operationalCapability).toMatchObject({
      backend: "UXP", minimumPremiereVersion: "25.6", hostVerificationRequired: true,
    });

    await tool.handler({
      media_type: "audio", track_index: 3, clip_index: 2, component_index: 1,
      expected_sequence_guid: "sequence-1", expected_component_id: "ADBE Volume",
    });
    expect(request).toHaveBeenCalledWith("parameters.catalog.inspect", {
      mediaType: "audio", trackIndex: 3, clipIndex: 2, componentIndex: 1,
      expectedSequenceGuid: "sequence-1", expectedComponentId: "ADBE Volume",
    });
  });
});
