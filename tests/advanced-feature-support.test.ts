import { describe, expect, it } from "vitest";
import { buildAdvancedFeatureSupport } from "../src/advanced-feature-support.js";
import { getHealthTools } from "../src/tools/health.js";

describe("advanced collaboration and AI feature support", () => {
  it("defaults to the production CEP transport and fails closed", () => {
    const report = buildAdvancedFeatureSupport();
    expect(report.context.backend).toBe("cep");
    expect(report.policy).toMatchObject({
      publicApisOnly: true,
      uiAutomation: false,
      privateApis: false,
      reportTool: {
        transport: "local",
        callableThroughCurrentMcpTransport: true,
        contactsPremiereHost: false,
      },
      featureOperations: {
        currentMcpTransport: "cep",
        uxpOperationsRoutedByCurrentMcpTransport: false,
        liveHostCapabilityNegotiationRequired: true,
      },
    });
    expect(report.features.productions).toMatchObject({
      status: "uxp-read-only",
      staticEligibility: {
        backendEligible: false,
        eligible: false,
      },
      liveHostVerificationRequired: true,
      callableThroughCurrentMcpTransport: false,
    });
  });

  it("marks documented Productions inspection available only for eligible UXP hosts", () => {
    expect(buildAdvancedFeatureSupport({ backend: "uxp", premiereVersion: "25.6.0" }).features.productions.staticEligibility.eligible).toBe(true);
    expect(buildAdvancedFeatureSupport({ backend: "uxp", premiereVersion: "25.5.9" }).features.productions.staticEligibility.eligible).toBe(false);
    expect(buildAdvancedFeatureSupport({ backend: "uxp" }).features.productions.staticEligibility.eligible).toBeNull();
  });

  it("keeps entitlements separate from API availability", () => {
    const report = buildAdvancedFeatureSupport({
      backend: "uxp",
      premiereVersion: "26.3",
      frameIoEntitled: true,
      generativeAiEntitled: true,
      networkAvailable: true,
    });
    expect(report.features.frameIo).toMatchObject({
      status: "external-api-required",
      entitlementSatisfied: true,
      callableThroughCurrentMcpTransport: false,
    });
    expect(report.features.generativeExtend).toMatchObject({
      status: "user-assisted",
      entitlementSatisfied: true,
      callableThroughCurrentMcpTransport: false,
    });
  });

  it("documents artifact detection boundaries without overstating provenance", () => {
    const features = buildAdvancedFeatureSupport().features;
    expect(features.generativeExtend.detection).toContain("No documented flag");
    expect(features.objectMask).toMatchObject({
      status: "partial",
      callableThroughCurrentMcpTransport: true,
    });
    expect(features.objectMask.detection).toContain("ObjectMaskUtils.hasObjectMask");
    expect(features.objectMask.unsupportedOperations).toContain("create an Object Mask");
    expect(features.captionTranslation.detection).toContain("No documented metadata");
    expect(features.remix.detection).toContain("not proof");
  });

  it("rejects non-numeric host versions", () => {
    expect(() => buildAdvancedFeatureSupport({ premiereVersion: "26.3-beta" })).toThrow("numeric version");
  });

  it("exposes the report through the health tool without contacting Premiere", async () => {
    const tool = getHealthTools({}).get_advanced_feature_support;
    const result = await tool.handler({ backend: "uxp", premiere_version: "26.3.0" });
    expect(result).toMatchObject({
      success: true,
      data: {
        context: { backend: "uxp", premiereVersion: "26.3.0" },
        features: {
          speechToText: {
            status: "user-assisted",
          },
        },
      },
    });
  });
});
