import { describe, expect, it } from "vitest";
import {
  buildFirstRunReport,
  collectLocalDoctor,
  createDoctorRepairPlan,
  createSupportBundle,
  renderDoctorHuman,
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
      expect.objectContaining({ id: "premiere_connector", code: "CEP_CONNECTOR_READY", boundary: "installed", state: "ready" }),
      expect.objectContaining({ id: "premiere_host", code: "PREMIERE_HOST_NOT_CHECKED", boundary: "live_verified", state: "not_checked" }),
    ]));
  });

  it("creates a privacy-safe, no-write repair plan with stable diagnostic codes", () => {
    const report = collectLocalDoctor({
      platform: "win32",
      nodeVersion: "v22.12.0",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      exists: () => false,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const plan = createDoctorRepairPlan(report);
    expect(plan).toMatchObject({
      schemaVersion: "premiere-pro-mcp.doctor-repair-plan.v1",
      actions: expect.arrayContaining([
        expect.objectContaining({ id: "install_cep_connector", diagnosticCode: "CEP_CONNECTOR_MISSING", canApplyLocally: true, createsBackup: true }),
        expect.objectContaining({ id: "verify_live_connection", diagnosticCode: "PREMIERE_HOST_NOT_CHECKED", canApplyLocally: false }),
      ]),
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("C:\\Users\\Example");
    expect(serialized).not.toContain("APPDATA");
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

  it("reports unsupported local layouts and malformed Node versions conservatively", () => {
    const report = collectLocalDoctor({
      platform: "linux", nodeVersion: "not-a-version", environment: {},
      exists: () => { throw new Error("must not inspect an unknown path"); },
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(report.overall).toBe("needs_attention");
    expect(report.runtime.nodeMajor).toBeNull();
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "node_runtime", code: "NODE_RUNTIME_UNSUPPORTED", state: "needs_attention" }),
      expect.objectContaining({ id: "premiere_connector", state: "needs_attention", repair: expect.any(String) }),
      expect.objectContaining({ id: "uxp_bridge", state: "not_checked" }),
    ]));
    const human = renderDoctorHuman(report);
    expect(human).toContain("Premiere MCP local check: needs attention");
    expect(human).toContain("Next: Install the Connector");
    expect(human).toContain("Not checked: UXP connection");
  });

  it("describes each reachable but incomplete first-run state", () => {
    const noProject = buildFirstRunReport("cep", { reachable: true });
    expect(noProject.overall).toBe("needs_attention");
    expect(noProject.components.find((item) => item.id === "active_project"))
      .toMatchObject({ state: "needs_attention", repair: expect.any(String) });
    expect(noProject.components.find((item) => item.id === "active_sequence"))
      .toMatchObject({ state: "needs_attention", repair: expect.any(String) });

    const noSequence = buildFirstRunReport("uxp", { reachable: true, projectOpen: true });
    expect(noSequence.components.find((item) => item.id === "active_project"))
      .toMatchObject({ state: "ready" });
    expect(noSequence.components.find((item) => item.id === "active_sequence"))
      .toMatchObject({ state: "needs_attention" });
  });

  it("recognizes the macOS connector path and configured UXP without exposing the token", () => {
    let inspected = "";
    const report = collectLocalDoctor({
      platform: "darwin", environment: { HOME: "/Users/example", PREMIERE_UXP_TOKEN: "secret" },
      exists: (file) => { inspected = file; return true; },
    });
    expect(inspected).toContain("Library");
    expect(report.components.find((item) => item.id === "uxp_bridge")).toMatchObject({ state: "ready" });
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(renderDoctorHuman(report)).toContain("Premiere MCP local check: ready");
  });
});
