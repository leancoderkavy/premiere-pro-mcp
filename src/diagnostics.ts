import { existsSync } from "node:fs";
import path from "node:path";

/**
 * A readiness boundary says what was actually established. It deliberately
 * does not turn an installed connector into a claim that Premiere is live.
 */
export type ReadinessBoundary =
  | "installed"
  | "configured"
  | "connected"
  | "live_verified";

export type ReadinessState = "ready" | "needs_attention" | "not_checked";

export interface ReadinessComponent {
  id: "mcp_process" | "node_runtime" | "premiere_connector" | "premiere_host" | "active_project" | "active_sequence" | "uxp_bridge";
  /** Stable, privacy-safe category for support and repair routing. */
  code: string;
  label: string;
  boundary: ReadinessBoundary;
  state: ReadinessState;
  message: string;
  repair?: string;
}

export interface LocalDoctorReport {
  schemaVersion: "premiere-pro-mcp.doctor.v1";
  generatedAt: string;
  runtime: {
    platform: NodeJS.Platform;
    nodeMajor: number | null;
  };
  overall: "ready" | "needs_attention";
  components: ReadinessComponent[];
  privacy: {
    includes: string[];
    excludes: string[];
  };
}

export interface DoctorRepairAction {
  id: "install_cep_connector" | "upgrade_node_runtime" | "configure_uxp_connection" | "verify_live_connection";
  diagnosticCode: string;
  title: string;
  canApplyLocally: boolean;
  requiresPremiereClosed: boolean;
  createsBackup: boolean;
  instruction: string;
  verification: string;
}

export interface DoctorRepairPlan {
  schemaVersion: "premiere-pro-mcp.doctor-repair-plan.v1";
  generatedAt: string;
  overall: "ready" | "needs_attention";
  actions: DoctorRepairAction[];
  privacy: { excludes: string[] };
  verificationBoundary: string;
}

export interface FirstRunReport {
  schemaVersion: "premiere-pro-mcp.first-run.v1";
  safeCheck: {
    readOnly: true;
    mutatesProject: false;
    verificationScope: "mcp_process_premiere_host_active_project_active_sequence";
  };
  backend: "cep" | "uxp";
  overall: "ready" | "needs_attention";
  components: ReadinessComponent[];
  nextStep: string;
  repair?: string;
}

export interface SupportBundle {
  schemaVersion: "premiere-pro-mcp.support-bundle.v1";
  generatedAt: string;
  application: {
    version: string;
    nodeMajor: number | null;
    platform: NodeJS.Platform;
    architecture: string;
  };
  doctor: LocalDoctorReport;
  privacy: {
    excludes: string[];
  };
}

export interface LocalDoctorOptions {
  platform?: NodeJS.Platform;
  architecture?: string;
  nodeVersion?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  exists?: (file: string) => boolean;
}

export interface SupportBundleOptions extends LocalDoctorOptions {
  version: string;
}

export interface FirstRunHostState {
  reachable: boolean;
  projectOpen?: boolean;
  sequenceOpen?: boolean;
}

const PRIVACY_EXCLUSIONS = [
  "prompts",
  "tool arguments or results",
  "project names",
  "media names",
  "project or media paths",
  "tokens or environment values",
  "IP addresses",
  "person profiles",
];

function installedComponent(installed: boolean): ReadinessComponent {
  return installed
    ? {
        id: "premiere_connector",
        code: "CEP_CONNECTOR_READY",
        label: "Premiere Connector",
        boundary: "installed",
        state: "ready",
        message: "The Premiere Connector is installed on this computer.",
      }
    : {
        id: "premiere_connector",
        code: "CEP_CONNECTOR_MISSING",
        label: "Premiere Connector",
        boundary: "installed",
        state: "needs_attention",
        message: "The Premiere Connector is not installed yet.",
        repair: "Install the Connector, then restart Premiere Pro.",
      };
}

function nodeMajor(nodeVersion: string): number | null {
  const match = /^v?(\d+)/.exec(nodeVersion);
  return match ? Number(match[1]) : null;
}

function nodeRuntimeReady(nodeVersion: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 20 || (major === 20 && minor >= 19);
}

function cepManifestPath(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): string | null {
  if (platform === "win32" && environment.APPDATA) {
    return path.join(environment.APPDATA, "Adobe", "CEP", "extensions", "MCPBridgeCEP", "CSXS", "manifest.xml");
  }
  if (platform === "darwin" && environment.HOME) {
    return path.join(environment.HOME, "Library", "Application Support", "Adobe", "CEP", "extensions", "MCPBridgeCEP", "CSXS", "manifest.xml");
  }
  return null;
}

/**
 * Inspect local install/configuration facts only. The report intentionally
 * cannot imply that Premiere is open or that an MCP client has connected.
 */
export function collectLocalDoctor(options: LocalDoctorOptions = {}): LocalDoctorReport {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const exists = options.exists ?? existsSync;
  const manifest = cepManifestPath(platform, environment);
  const connectorInstalled = manifest ? exists(manifest) : false;
  const uxpConfigured = Boolean(environment.PREMIERE_UXP_TOKEN);
  const nodeVersion = options.nodeVersion ?? process.version;
  const now = options.now ?? (() => new Date());

  const components: ReadinessComponent[] = [
    {
      id: "mcp_process",
      code: "MCP_SERVER_LOCAL",
      label: "MCP server",
      boundary: "installed",
      state: "ready",
      message: "This copy of Premiere MCP can run on this computer.",
    },
    {
      id: "node_runtime",
      code: nodeRuntimeReady(nodeVersion) ? "NODE_RUNTIME_SUPPORTED" : "NODE_RUNTIME_UNSUPPORTED",
      label: "Node.js runtime",
      boundary: "installed",
      state: nodeRuntimeReady(nodeVersion) ? "ready" : "needs_attention",
      message: nodeRuntimeReady(nodeVersion)
        ? "The local Node.js runtime meets Premiere MCP's supported minimum."
        : "The local Node.js runtime is below the supported Node.js 20.19 minimum or could not be identified.",
      ...(nodeRuntimeReady(nodeVersion) ? {} : { repair: "Install a supported Node.js runtime, then run the local check again." }),
    },
    installedComponent(connectorInstalled),
    {
      id: "uxp_bridge",
      code: uxpConfigured ? "UXP_CONNECTION_CONFIGURED" : "UXP_CONNECTION_NOT_CONFIGURED",
      label: "UXP connection",
      boundary: "configured",
      state: uxpConfigured ? "ready" : "not_checked",
      message: uxpConfigured
        ? "A UXP connection is configured. Its token is never included in this report."
        : "A UXP connection is not configured. This is only needed when you choose the UXP route.",
    },
    {
      id: "premiere_host",
      code: "PREMIERE_HOST_NOT_CHECKED",
      label: "Live Premiere check",
      boundary: "live_verified",
      state: "not_checked",
      message: "A local install check cannot prove that Premiere Pro is open and connected.",
      repair: "Open Premiere Pro and run the safe connection check from your AI assistant.",
    },
  ];

  return {
    schemaVersion: "premiere-pro-mcp.doctor.v1",
    generatedAt: now().toISOString(),
    runtime: {
      platform,
      nodeMajor: nodeMajor(nodeVersion),
    },
    overall: connectorInstalled && nodeRuntimeReady(nodeVersion) ? "ready" : "needs_attention",
    components,
    privacy: {
      includes: ["component readiness", "operating system", "Node.js major version"],
      excludes: PRIVACY_EXCLUSIONS,
    },
  };
}

/**
 * Build a no-write repair plan from local readiness facts. It intentionally
 * cannot inspect or repair a running Premiere host, a project, a sequence, or
 * any secret-bearing configuration.
 */
export function createDoctorRepairPlan(report: LocalDoctorReport): DoctorRepairPlan {
  const actions: DoctorRepairAction[] = [];
  const runtime = report.components.find((component) => component.id === "node_runtime");
  const connector = report.components.find((component) => component.id === "premiere_connector");
  const uxp = report.components.find((component) => component.id === "uxp_bridge");
  const host = report.components.find((component) => component.id === "premiere_host");

  if (runtime?.state === "needs_attention") {
    actions.push({
      id: "upgrade_node_runtime",
      diagnosticCode: runtime.code,
      title: "Install a supported Node.js runtime",
      canApplyLocally: false,
      requiresPremiereClosed: false,
      createsBackup: false,
      instruction: "Install Node.js 20.19 or later using your approved system package process, then rerun premiere-pro-mcp --doctor.",
      verification: "A new local doctor report must show NODE_RUNTIME_SUPPORTED. This does not verify Premiere.",
    });
  }
  if (connector?.state === "needs_attention") {
    const canApplyLocally = report.runtime.platform === "win32" || report.runtime.platform === "darwin";
    actions.push({
      id: "install_cep_connector",
      diagnosticCode: connector.code,
      title: "Install the local Premiere Connector",
      canApplyLocally,
      requiresPremiereClosed: true,
      createsBackup: true,
      instruction: canApplyLocally
        ? "Fully quit Premiere Pro. --apply-fixes can back up an incomplete local connector directory, run the existing connector installer, and rerun the local check."
        : "Install the Premiere Connector on a supported Windows or macOS computer, then rerun the local check.",
      verification: "A new local doctor report can verify installed connector files only; it cannot verify that Premiere is open or connected.",
    });
  }
  if (uxp?.state === "not_checked") {
    actions.push({
      id: "configure_uxp_connection",
      diagnosticCode: uxp.code,
      title: "Configure UXP only when you choose that backend",
      canApplyLocally: false,
      requiresPremiereClosed: false,
      createsBackup: false,
      instruction: "Set up the authenticated local UXP bridge through the documented client and panel flow. Do not paste a token into a support bundle or repair plan.",
      verification: "A local check can report only that a token is configured, never the token value or a live host connection.",
    });
  }
  if (host?.state === "not_checked") {
    actions.push({
      id: "verify_live_connection",
      diagnosticCode: host.code,
      title: "Run a safe live connection check",
      canApplyLocally: false,
      requiresPremiereClosed: false,
      createsBackup: false,
      instruction: "Open Premiere Pro and use your MCP client's safe connection check before editing.",
      verification: "This is the first step that can establish a client-to-host connection; it still does not verify playback or render quality.",
    });
  }

  return {
    schemaVersion: "premiere-pro-mcp.doctor-repair-plan.v1",
    generatedAt: report.generatedAt,
    overall: report.overall,
    actions,
    privacy: { excludes: [...report.privacy.excludes] },
    verificationBoundary: "This no-write plan contains local readiness guidance only. It does not expose paths, tokens, project data, or host state, and it cannot claim a repair or live Premiere connection.",
  };
}

/** Build a first-run report from a sanitized host response. No names or paths enter this contract. */
export function buildFirstRunReport(
  backend: "cep" | "uxp",
  host: FirstRunHostState,
): FirstRunReport {
  const mcpProcess: ReadinessComponent = {
    id: "mcp_process",
    code: "MCP_SERVER_CONNECTED",
    label: "AI assistant connection",
    boundary: "connected",
    state: "ready",
    message: "Your AI assistant reached the Premiere MCP server.",
  };

  if (!host.reachable) {
    return {
      schemaVersion: "premiere-pro-mcp.first-run.v1",
      safeCheck: {
        readOnly: true,
        mutatesProject: false,
        verificationScope: "mcp_process_premiere_host_active_project_active_sequence",
      },
      backend,
      overall: "needs_attention",
      components: [
        mcpProcess,
        {
          id: "premiere_connector",
          code: "PREMIERE_CONNECTOR_UNREACHABLE",
          label: "Premiere Connector",
          boundary: "connected",
          state: "needs_attention",
          message: "Premiere Pro did not answer the safe connection check.",
          repair: "In Premiere Pro, open Window > Extensions > MCP Bridge and make sure it says Running. Close any open Premiere dialog, then try again.",
        },
        {
          id: "active_project",
          code: "ACTIVE_PROJECT_NOT_CHECKED",
          label: "Active project",
          boundary: "live_verified",
          state: "not_checked",
          message: "Premiere did not respond, so project status is unknown.",
        },
        {
          id: "active_sequence",
          code: "ACTIVE_SEQUENCE_NOT_CHECKED",
          label: "Active sequence",
          boundary: "live_verified",
          state: "not_checked",
          message: "Premiere did not respond, so sequence status is unknown.",
        },
      ],
      nextStep: "Reconnect the Premiere Connector, then run this safe check again.",
      repair: "If the Connector still does not respond, run get_capabilities to compare the selected bridge directory with the CEP panel, then run premiere-pro-mcp --diagnose-cep and follow its repair guidance.",
    };
  }

  const projectOpen = host.projectOpen === true;
  const sequenceOpen = host.sequenceOpen === true;
  const components: ReadinessComponent[] = [
    mcpProcess,
    {
      id: "premiere_connector",
      code: "PREMIERE_CONNECTOR_CONNECTED",
      label: "Premiere Connector",
      boundary: "connected",
      state: "ready",
      message: "Premiere Pro answered the safe connection check.",
    },
    {
      id: "active_project",
      code: projectOpen ? "ACTIVE_PROJECT_OPEN" : "ACTIVE_PROJECT_MISSING",
      label: "Active project",
      boundary: "live_verified",
      state: projectOpen ? "ready" : "needs_attention",
      message: projectOpen
        ? "Premiere confirmed that a project is open."
        : "Premiere is connected, but no project is open.",
      ...(projectOpen ? {} : { repair: "Open the project you want to work on, then run this safe check again." }),
    },
    {
      id: "active_sequence",
      code: sequenceOpen ? "ACTIVE_SEQUENCE_OPEN" : "ACTIVE_SEQUENCE_MISSING",
      label: "Active sequence",
      boundary: "live_verified",
      state: sequenceOpen ? "ready" : "needs_attention",
      message: sequenceOpen
        ? "Premiere confirmed that an active sequence is open."
        : "Premiere is connected, but no active sequence is open.",
      ...(sequenceOpen ? {} : { repair: "Open a sequence in Premiere Pro, then run this safe check again." }),
    },
  ];
  const ready = projectOpen && sequenceOpen;
  return {
    schemaVersion: "premiere-pro-mcp.first-run.v1",
    safeCheck: {
      readOnly: true,
      mutatesProject: false,
      verificationScope: "mcp_process_premiere_host_active_project_active_sequence",
    },
    backend,
    overall: ready ? "ready" : "needs_attention",
    components,
    nextStep: ready
      ? "Ready to edit. Start with an inspection or a preview before applying changes."
      : "Open the missing Premiere item, then run this safe check again.",
  };
}

/**
 * Produce a safe attachment for support. It is deliberately a status snapshot,
 * not a log collector: logs commonly contain project names, local paths, or tokens.
 */
export function createSupportBundle(options: SupportBundleOptions): SupportBundle {
  const nodeVersion = options.nodeVersion ?? process.version;
  const platform = options.platform ?? process.platform;
  const now = options.now ?? (() => new Date());
  return {
    schemaVersion: "premiere-pro-mcp.support-bundle.v1",
    generatedAt: now().toISOString(),
    application: {
      version: options.version,
      nodeMajor: nodeMajor(nodeVersion),
      platform,
      architecture: options.architecture ?? process.arch,
    },
    doctor: collectLocalDoctor({ ...options, platform, nodeVersion, now }),
    privacy: { excludes: PRIVACY_EXCLUSIONS },
  };
}

export function renderDoctorHuman(report: LocalDoctorReport): string {
  const lines = [
    report.overall === "ready" ? "Premiere MCP local check: ready" : "Premiere MCP local check: needs attention",
    "",
  ];
  for (const component of report.components) {
    const status = component.state === "ready" ? "Ready" : component.state === "not_checked" ? "Not checked" : "Needs attention";
    lines.push(`${status}: ${component.label} — ${component.message}`);
    if (component.repair) lines.push(`  Next: ${component.repair}`);
  }
  lines.push("", "This check does not access project names, media names, paths, tokens, prompts, or tool results.");
  return lines.join("\n");
}
