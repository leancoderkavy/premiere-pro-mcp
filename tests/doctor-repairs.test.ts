import { describe, expect, it, vi } from "vitest";
import { applyDoctorRepairPlan } from "../src/doctor-repairs.js";
import { collectLocalDoctor, createDoctorRepairPlan } from "../src/diagnostics.js";

function missingConnectorReport() {
  return collectLocalDoctor({
    platform: "win32",
    nodeVersion: "v22.12.0",
    environment: { APPDATA: "C:\\Users\\Example\\AppData" },
    exists: () => false,
    now: () => new Date("2026-09-04T00:00:00.000Z"),
  });
}

describe("doctor repair application", () => {
  it("withholds a connector write until Premiere closure is explicitly confirmed", () => {
    const runInstaller = vi.fn();
    const result = applyDoctorRepairPlan(createDoctorRepairPlan(missingConnectorReport()), {
      projectRoot: "D:\\fixture",
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      runInstaller,
      collect: missingConnectorReport,
    });

    expect(runInstaller).not.toHaveBeenCalled();
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "install_cep_connector", status: "withheld", backupCreated: false }),
    ]));
    expect(JSON.stringify(result)).not.toContain("C:\\Users\\Example");
  });

  it("backs up an incomplete connector before an explicit installer run and rechecks local readiness", () => {
    const rename = vi.fn();
    const runInstaller = vi.fn();
    const readyReport = collectLocalDoctor({
      platform: "win32",
      nodeVersion: "v22.12.0",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      exists: () => true,
      now: () => new Date("2026-09-04T00:00:01.000Z"),
    });
    const result = applyDoctorRepairPlan(createDoctorRepairPlan(missingConnectorReport()), {
      projectRoot: "D:\\fixture",
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      confirmPremiereClosed: true,
      exists: () => true,
      rename,
      runInstaller,
      collect: () => readyReport,
      now: () => new Date("2026-09-04T00:00:01.000Z"),
    });

    expect(rename).toHaveBeenCalledOnce();
    expect(runInstaller).toHaveBeenCalledWith("win32", "D:\\fixture");
    expect(result).toMatchObject({
      applied: true,
      actions: expect.arrayContaining([
        expect.objectContaining({ id: "install_cep_connector", status: "applied", backupCreated: true }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("C:\\Users\\Example");
  });
});
