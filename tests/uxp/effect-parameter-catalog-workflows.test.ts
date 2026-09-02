import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

type Options = {
  changeParameterOnSecondSnapshot?: boolean;
  parameterCount?: number;
};

function parameterCatalogHost(options: Options = {}) {
  let parameterCalls = 0;
  const parameters = Array.from({ length: options.parameterCount ?? 2 }, (_, index) => ({
    displayName: index === 0 ? "Opacity" : "Blend Mode",
    areKeyframesSupported: vi.fn(async () => index === 0),
    isTimeVarying: vi.fn(() => index === 0),
    getStartValue: vi.fn(),
    getValueAtTime: vi.fn(),
  }));
  const component = {
    getMatchName: vi.fn(async () => "ADBE Opacity"),
    getDisplayName: vi.fn(async () => "Opacity"),
    getParamCount: vi.fn(() => parameters.length),
    getParam: vi.fn((index: number) => {
      parameterCalls += 1;
      if (options.changeParameterOnSecondSnapshot && parameterCalls > parameters.length && index === 0) {
        return { ...parameters[index], displayName: "Changed Opacity" };
      }
      return parameters[index];
    }),
  };
  const chain = {
    getComponentCount: vi.fn(() => 1),
    getComponentAtIndex: vi.fn(() => component),
  };
  const item = { getComponentChain: vi.fn(async () => chain) };
  const videoTrack = { getTrackItems: vi.fn(async () => [item]) };
  const sequence = {
    guid: "sequence-1",
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => videoTrack),
    getAudioTrackCount: vi.fn(async () => 0),
    getAudioTrack: vi.fn(),
  };
  const project = { guid: "project-1", getActiveSequence: vi.fn(async () => sequence) };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    Constants: { TrackItemType: { CLIP: 1 } },
  };
  return {
    ppro, project, sequence, videoTrack, item, component, parameters,
    registry: Commands.createCommandRegistry({ ppro, Protocol }),
  };
}

describe("bounded documented UXP effect-parameter catalog", () => {
  it("advertises a read-only target-probed command and returns a double-read bounded descriptor catalog", async () => {
    const value = parameterCatalogHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "parameters.catalog.inspect": {
        supported: true, readOnly: true, minHostVersion: "25.6.0", targetCapabilityProbe: "invocation",
      },
    } });
    value.project.getActiveSequence.mockClear();
    value.videoTrack.getTrackItems.mockClear();
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0,
      expectedSequenceGuid: "sequence-1", expectedComponentId: "ADBE Opacity",
    })).resolves.toEqual({
      projectGuid: "project-1",
      sequenceGuid: "sequence-1",
      mediaType: "video",
      trackIndex: 0,
      clipIndex: 0,
      componentIndex: 0,
      component: { id: "ADBE Opacity", matchName: "ADBE Opacity", displayName: "Opacity" },
      parameterCount: 2,
      parameters: [
        { index: 0, displayName: "Opacity", keyframesSupported: true, timeVarying: true },
        { index: 1, displayName: "Blend Mode", keyframesSupported: false, timeVarying: false },
      ],
      verificationBoundary: "bounded_effect_parameter_catalog_double_readback",
    });
    expect(value.project.getActiveSequence).toHaveBeenCalledTimes(2);
    expect(value.videoTrack.getTrackItems).toHaveBeenCalledTimes(2);
    expect(value.parameters[0].getStartValue).not.toHaveBeenCalled();
    expect(value.parameters[0].getValueAtTime).not.toHaveBeenCalled();
  });

  it("rejects invalid, stale, and oversized targets before returning an ambiguous catalog", async () => {
    const value = parameterCatalogHost();
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, unexpected: true,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "caption", trackIndex: 0, clipIndex: 0, componentIndex: 0,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, expectedSequenceGuid: "",
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 1, clipIndex: 0, componentIndex: 0,
    })).rejects.toMatchObject({ code: "UXP_TARGET_NOT_FOUND" });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, expectedSequenceGuid: "other-sequence",
    })).rejects.toMatchObject({ code: "UXP_STALE_PARAMETER_CATALOG" });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0, expectedComponentId: "other-component",
    })).rejects.toMatchObject({ code: "UXP_STALE_PARAMETER_CATALOG" });

    const tooMany = parameterCatalogHost({ parameterCount: 65 });
    await expect(tooMany.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0,
    })).rejects.toMatchObject({ code: "UXP_TARGET_TOO_LARGE" });
  });

  it("fails closed when a parameter descriptor changes during the complete double read", async () => {
    const value = parameterCatalogHost({ changeParameterOnSecondSnapshot: true });
    await expect(value.registry.dispatch("parameters.catalog.inspect", {
      mediaType: "video", trackIndex: 0, clipIndex: 0, componentIndex: 0,
    })).rejects.toMatchObject({ code: "UXP_STALE_PARAMETER_CATALOG" });
  });

  it("does not claim support when active-project access is absent", async () => {
    const value = parameterCatalogHost();
    delete (value.ppro as { Project?: unknown }).Project;
    const registry = Commands.createCommandRegistry({ ppro: value.ppro, Protocol });
    await expect(registry.capabilities()).resolves.toMatchObject({ commands: {
      "parameters.catalog.inspect": { supported: false, reason: expect.any(String) },
    } });
  });
});
