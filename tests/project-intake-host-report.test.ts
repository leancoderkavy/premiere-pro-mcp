import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "premiere-project-intake-host-report-"));
const validator = path.resolve("scripts/validate-project-intake-host-report.mjs");

function evidence(kind: string, reference: string) {
  return { kind, reference: `evidence://${reference}`, sha256: "d".repeat(64) };
}

function completeSyntheticReport() {
  return {
    schemaVersion: "project-intake-host-report/v1",
    sourceCommit: "a".repeat(40),
    host: {
      os: "Windows",
      premiereVersion: "26.0.0",
      premiereBuild: "26.0.0-build-1",
      connector: { type: "cep", buildHash: "b".repeat(40) },
    },
    client: { name: "test-client", version: "1.0.0" },
    fixture: { revision: "generated-fixture-v1", sha256: "c".repeat(64) },
    privacy: {
      containsOnlyGeneratedFixtureData: true,
      localPathsRemoved: true,
      mediaNamesRemoved: true,
      promptsRemoved: true,
      transcriptsRemoved: true,
      credentialsRemoved: true,
    },
    cases: [
      {
        id: "PIP-CONNECT-001",
        status: "passed",
        executedAt: "2026-08-23T00:00:00Z",
        assertions: { tool: "verify_premiere_connection", overall: "ready" },
        evidence: [evidence("structured_connection_response", "connection")],
      },
      {
        id: "PIP-PREVIEW-001",
        status: "passed",
        executedAt: "2026-08-23T00:01:00Z",
        assertions: {
          tool: "preview_project_intake",
          applied: false,
          pathDisclosure: "redacted",
          organizationPlanApplied: false,
        },
        evidence: [evidence("structured_preview_response", "preview")],
      },
      {
        id: "PIP-NO-MUTATION-001",
        status: "passed",
        executedAt: "2026-08-23T00:02:00Z",
        assertions: { tool: "preview_project_intake", projectMutated: false, projectSaved: false },
        evidence: [
          evidence("before_project_panel", "before-panel"),
          evidence("after_project_panel", "after-panel"),
          evidence("structured_preview_response", "preview-no-mutation"),
        ],
      },
    ],
  };
}

function validate(report: unknown) {
  const reportPath = path.join(tempDirectory, `${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report));
  return spawnSync(process.execPath, [validator, reportPath], { encoding: "utf8" });
}

afterAll(() => fs.rmSync(tempDirectory, { recursive: true, force: true }));

describe("Project Intake licensed-host report validator", () => {
  it("accepts the not-run template without treating it as host verification", () => {
    const template = JSON.parse(fs.readFileSync("docs/project-intake-host-report.template.json", "utf8"));
    const result = validate(template);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"not_run": 3');
    expect(result.stdout).toContain('"licensedHostVerifiedByValidator": false');
  });

  it("validates a structurally complete synthetic fixture without treating it as host evidence", () => {
    const result = validate(completeSyntheticReport());

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"passed": 3');
    expect(result.stdout).toContain('"humanReviewRequired": true');
    expect(result.stdout).toContain('"licensedHostVerifiedByValidator": false');
  });

  it("fails closed when a preview report reveals paths or fails its redacted postcondition", () => {
    const report = completeSyntheticReport();
    report.cases[1].assertions.pathDisclosure = "requested";
    report.client.name = "C:/restricted";
    const result = validate(report);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pathDisclosure must be \"redacted\"");
    expect(result.stderr).toContain("project data, a local path, or credential-like content");
  });

  it("requires no-mutation evidence whenever the Project Intake preview passes", () => {
    const report = completeSyntheticReport();
    report.cases[2].status = "not_run";
    delete report.cases[2].executedAt;
    delete report.cases[2].assertions;
    report.cases[2].evidence = [];
    const result = validate(report);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PIP-PREVIEW-001 cannot pass unless PIP-NO-MUTATION-001 also passes");
  });
});
