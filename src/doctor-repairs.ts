import { existsSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  collectLocalDoctor,
  type DoctorRepairPlan,
  type LocalDoctorReport,
} from "./diagnostics.js";

export interface DoctorRepairApplyOptions {
  projectRoot: string;
  confirmPremiereClosed?: boolean;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  exists?: (value: string) => boolean;
  rename?: (from: string, to: string) => void;
  runInstaller?: (platform: NodeJS.Platform, projectRoot: string) => void;
  collect?: () => LocalDoctorReport;
}

export interface DoctorRepairResult {
  schemaVersion: "premiere-pro-mcp.doctor-repair-result.v1";
  applied: boolean;
  actions: Array<{
    id: string;
    status: "applied" | "withheld" | "manual_required" | "failed";
    backupCreated: boolean;
    message: string;
  }>;
  doctor: LocalDoctorReport;
  verificationBoundary: string;
}

function connectorDirectory(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string | undefined {
  if (platform === "win32" && environment.APPDATA) {
    return path.join(environment.APPDATA, "Adobe", "CEP", "extensions", "MCPBridgeCEP");
  }
  if (platform === "darwin" && environment.HOME) {
    return path.join(environment.HOME, "Library", "Application Support", "Adobe", "CEP", "extensions", "MCPBridgeCEP");
  }
  return undefined;
}

function defaultRunInstaller(platform: NodeJS.Platform, projectRoot: string): void {
  if (platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(projectRoot, "scripts", "install-cep.ps1"),
    ], { stdio: "inherit", cwd: projectRoot, windowsHide: true });
    return;
  }
  if (platform === "darwin") {
    execFileSync("bash", [path.join(projectRoot, "scripts", "install-cep.sh"), "--copy"], {
      stdio: "inherit",
      cwd: projectRoot,
    });
    return;
  }
  throw new Error(`Connector repair is unsupported on ${platform}`);
}

/**
 * Apply only the plan's explicitly local connector repair. Existing connector
 * content is moved aside first and never deleted by this helper. It cannot
 * prove Premiere is closed, so that fact remains an explicit CLI confirmation.
 */
export function applyDoctorRepairPlan(
  plan: DoctorRepairPlan,
  options: DoctorRepairApplyOptions,
): DoctorRepairResult {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  const exists = options.exists ?? existsSync;
  const rename = options.rename ?? renameSync;
  const runInstaller = options.runInstaller ?? defaultRunInstaller;
  const collect = options.collect ?? (() => collectLocalDoctor({ platform, environment }));
  const actions: DoctorRepairResult["actions"] = [];
  let applied = false;

  for (const action of plan.actions) {
    if (action.id !== "install_cep_connector") {
      actions.push({
        id: action.id,
        status: "manual_required",
        backupCreated: false,
        message: action.instruction,
      });
      continue;
    }
    if (!action.canApplyLocally) {
      actions.push({ id: action.id, status: "manual_required", backupCreated: false, message: action.instruction });
      continue;
    }
    if (action.requiresPremiereClosed && options.confirmPremiereClosed !== true) {
      actions.push({
        id: action.id,
        status: "withheld",
        backupCreated: false,
        message: "No local files were changed because Premiere closure was not explicitly confirmed. Fully quit Premiere, then rerun with --confirm-premiere-closed.",
      });
      continue;
    }
    const destination = connectorDirectory(platform, environment);
    if (!destination) {
      actions.push({ id: action.id, status: "manual_required", backupCreated: false, message: action.instruction });
      continue;
    }
    let backupCreated = false;
    try {
      if (exists(destination)) {
        const backup = `${destination}.backup-${now().toISOString().replace(/[^0-9]/g, "")}`;
        rename(destination, backup);
        backupCreated = true;
      }
      runInstaller(platform, options.projectRoot);
      const after = collect();
      const connector = after.components.find((component) => component.id === "premiere_connector");
      if (connector?.state !== "ready") {
        actions.push({
          id: action.id,
          status: "failed",
          backupCreated,
          message: "The installer finished without a ready local connector report. The retained backup was not deleted; inspect it before retrying.",
        });
        continue;
      }
      applied = true;
      actions.push({
        id: action.id,
        status: "applied",
        backupCreated,
        message: "The connector installer completed and a fresh local check found connector files. Restart Premiere and run a safe connection check before editing.",
      });
    } catch {
      actions.push({
        id: action.id,
        status: "failed",
        backupCreated,
        message: "Connector repair failed. Any backup was retained and was not deleted; run the existing connector diagnostics for local detail before retrying.",
      });
    }
  }

  return {
    schemaVersion: "premiere-pro-mcp.doctor-repair-result.v1",
    applied,
    actions,
    doctor: collect(),
    verificationBoundary: "A successful local repair verifies only current local readiness components. It does not prove that Premiere is open, a client is connected, a project is selected, or an edit/render works.",
  };
}
