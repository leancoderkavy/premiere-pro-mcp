import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const createScript = join(root, "scripts", "create-licensed-host-sweep.mjs");
const validateScript = join(root, "scripts", "validate-licensed-host-report.mjs");
const fixtureHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createReport() {
  return JSON.parse(execFileSync(process.execPath, [
    createScript,
    "--host-os", "Windows",
    "--premiere-version", "26.3.0",
    "--panel-build", "0123abcd",
    "--fixture-revision", "generated-fixture-v1",
    "--fixture-sha256", fixtureHash,
  ], { cwd: root, encoding: "utf8" }));
}

function validate(report: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "premiere-host-sweep-"));
  const reportPath = join(directory, "report.json");
  try {
    writeFileSync(reportPath, `${JSON.stringify(report)}\n`, "utf8");
    return execFileSync(process.execPath, [validateScript, reportPath], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("licensed-host sweep reporting", () => {
  it("keeps the checked-in report template aligned with the privacy-safe schema", () => {
    const schema = JSON.parse(readFileSync(join(root, "docs", "licensed-host-sweep.schema.json"), "utf8"));
    const matrix = JSON.parse(readFileSync(join(root, "docs", "licensed-host-sweep.matrix.json"), "utf8"));
    const template = JSON.parse(readFileSync(join(root, "docs", "licensed-host-sweep.template.json"), "utf8"));

    expect(schema.properties.schemaVersion.const).toBe("premiere-pro-mcp.licensed-host-sweep.v1");
    expect(template.sweep.matrixId).toBe(matrix.id);
    expect(template.cases.map((entry: { id: string }) => entry.id)).toEqual(matrix.cases.map((entry: { id: string }) => entry.id));
  });

  it("generates a not-run sweep skeleton and accepts it without private evidence", () => {
    const report = createReport();
    expect(report).toMatchObject({
      schemaVersion: "premiere-pro-mcp.licensed-host-sweep.v1",
      host: { os: "Windows", premiereVersion: "26.3.0" },
      fixture: { revision: "generated-fixture-v1", sha256: fixtureHash },
    });
    expect(report.cases).toHaveLength(4);
    expect(validate(report)).toContain('"not_run": 4');
  });

  it("continues to accept the focused editorial report template", () => {
    const editorialTemplate = JSON.parse(readFileSync(join(root, "docs", "licensed-host-report.template.json"), "utf8"));
    expect(validate(editorialTemplate)).toContain('"schemaVersion": "legacy-editorial-report"');
  });

  it("rejects raw paths and requires opaque evidence references", () => {
    const report = createReport();
    report.cases[0] = {
      ...report.cases[0],
      status: "passed",
      evidence: [
        { kind: "host_state", ref: "C:\\private\\before.png" },
        { kind: "structured_response", ref: "connection-response-001" },
      ],
    };
    expect(() => validate(report)).toThrow(/opaque non-sensitive IDs|local path/i);
  });

  it("rejects extra fields that could turn a report into an unredacted evidence dump", () => {
    const report = createReport();
    report.host.machineName = "editing-workstation";
    expect(() => validate(report)).toThrow(/host must contain only/i);
  });
});
