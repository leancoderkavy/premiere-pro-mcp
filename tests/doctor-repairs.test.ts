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

  it("keeps non-connector and non-applicable repair guidance manual", () => {
    const plan = createDoctorRepairPlan(missingConnectorReport());
    const connector = plan.actions.find((action) => action.id === "install_cep_connector")!;
    const runInstaller = vi.fn();
    const result = applyDoctorRepairPlan({
      ...plan,
      actions: [
        { ...connector, id: "upgrade_node_runtime", canApplyLocally: false },
        { ...connector, canApplyLocally: false },
      ],
    }, {
      projectRoot: "D:\\fixture",
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      confirmPremiereClosed: true,
      runInstaller,
      collect: missingConnectorReport,
    });

    expect(runInstaller).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((action) => action.status === "manual_required")).toBe(true);
  });

  it("fails closed when no supported connector directory is available or a post-install recheck is not ready", () => {
    const plan = createDoctorRepairPlan(missingConnectorReport());
    const unavailable = applyDoctorRepairPlan(plan, {
      projectRoot: "D:\\fixture",
      platform: "linux",
      environment: {},
      confirmPremiereClosed: true,
      runInstaller: vi.fn(),
      collect: missingConnectorReport,
    });
    expect(unavailable.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "install_cep_connector", status: "manual_required" }),
    ]));

    const runInstaller = vi.fn();
    const incomplete = applyDoctorRepairPlan(plan, {
      projectRoot: "D:\\fixture",
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      confirmPremiereClosed: true,
      exists: () => false,
      runInstaller,
      collect: missingConnectorReport,
    });
    expect(runInstaller).toHaveBeenCalledOnce();
    expect(incomplete.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "install_cep_connector", status: "failed", backupCreated: false }),
    ]));
  });

  it("retains a backup and reports a failed result when connector installation throws", () => {
    const rename = vi.fn();
    const result = applyDoctorRepairPlan(createDoctorRepairPlan(missingConnectorReport()), {
      projectRoot: "D:\\fixture",
      platform: "win32",
      environment: { APPDATA: "C:\\Users\\Example\\AppData" },
      confirmPremiereClosed: true,
      exists: () => true,
      rename,
      runInstaller: () => { throw new Error("fixture installer failure"); },
      collect: missingConnectorReport,
      now: () => new Date("2026-09-04T00:00:01.000Z"),
    });

    expect(rename).toHaveBeenCalledOnce();
    expect(result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "install_cep_connector", status: "failed", backupCreated: true }),
    ]));
  });
});
