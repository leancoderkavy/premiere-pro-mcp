import { describe, expect, it } from "vitest";
import {
  buildFirstRunReport,
  collectLocalDoctor,
  createSupportBundle,
} from "../src/diagnostics.js";

describe("non-technical diagnostics", () => {
  it("keeps local doctor states separate from a live Premiere verification", () => {
    const report = collectLocalDoctor({
      platform: "win32",
      nodeVersion: "v22.12.0",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      exists: (file) => file.endsWith("manifest.xml"),
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(report.overall).toBe("ready");
    expect(report.runtime).toEqual({ platform: "win32", nodeMajor: 22 });
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "premiere_connector", boundary: "installed", state: "ready" }),
      expect.objectContaining({ id: "premiere_host", boundary: "live_verified", state: "not_checked" }),
    ]));
  });

  it("proves the complete first-run lane with booleans only", () => {
    const report = buildFirstRunReport("cep", {
      reachable: true,
      projectOpen: true,
      sequenceOpen: true,
    });

    expect(report).toMatchObject({
      overall: "ready",
      safeCheck: { readOnly: true, mutatesProject: false },
    });
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mcp_process", boundary: "connected", state: "ready" }),
      expect.objectContaining({ id: "premiere_connector", boundary: "connected", state: "ready" }),
      expect.objectContaining({ id: "active_project", boundary: "live_verified", state: "ready" }),
      expect.objectContaining({ id: "active_sequence", boundary: "live_verified", state: "ready" }),
    ]));
  });

  it("gives a repairable outcome when the connector cannot answer", () => {
    const report = buildFirstRunReport("uxp", { reachable: false });

    expect(report.overall).toBe("needs_attention");
    expect(report.safeCheck.mutatesProject).toBe(false);
    expect(report.components.find((component) => component.id === "premiere_connector"))
      .toMatchObject({ boundary: "connected", state: "needs_attention" });
    expect(report.repair).toContain("diagnose-cep");
  });

  it("creates a support snapshot without credentials, paths, or project data", () => {
    const bundle = createSupportBundle({
      version: "1.7.0",
      platform: "win32",
      architecture: "x64",
      nodeVersion: "v22.12.0",
      environment: {
        APPDATA: "C:\\Users\\Private\\AppData",
        PREMIERE_UXP_TOKEN: "very-secret-token-value",
        POSTHOG_API_KEY: "another-secret",
      },
      exists: () => true,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
    });
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain("very-secret-token-value");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("C:\\Users\\Private");
    expect(serialized).not.toMatch(/"(?:projectName|mediaName|outputDirectory|arguments|results)"\s*:/);
  });
});
