import { randomUUID } from "node:crypto";

export const CAPABILITIES = ["inspect", "edit", "export", "filesystem", "unsafe-script"] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityConfig {
  capabilities: ReadonlySet<Capability>;
  source: "default" | "environment" | "explicit";
}

const KNOWN = new Set<string>(CAPABILITIES);

/**
 * Resolve the server's authority. Unsafe scripting is deliberately never part
 * of the default: an operator must name it explicitly.
 */
export function resolveCapabilities(
  value: string | undefined = process.env.PREMIERE_MCP_CAPABILITIES,
): CapabilityConfig {
  if (value === undefined || value.trim() === "") {
    return { capabilities: new Set<Capability>(["inspect", "edit", "export", "filesystem"]), source: "default" };
  }

  const capabilities = new Set<Capability>();
  for (const raw of value.split(",")) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (!KNOWN.has(name)) {
      throw new Error(`Unknown Premiere MCP capability: ${name}`);
    }
    capabilities.add(name as Capability);
  }
  return { capabilities, source: "environment" };
}

export class CapabilityDeniedError extends Error {
  readonly code = "CAPABILITY_DENIED";

  constructor(readonly capability: Capability, readonly operationId: string) {
    super(`Operation ${operationId} requires the '${capability}' capability`);
    this.name = "CapabilityDeniedError";
  }
}

export function requireCapability(
  config: CapabilityConfig,
  capability: Capability,
  operationId: string,
): void {
  if (!config.capabilities.has(capability)) {
    throw new CapabilityDeniedError(capability, operationId);
  }
}

export const UNSAFE_TOOL_NAMES = new Set(["execute_extendscript", "send_raw_script", "evaluate_expression"]);

const INSPECT_TOOL_NAMES = new Set(["ping", "get_capabilities", "preview_edit_plan"]);
const FILESYSTEM_TOOL_NAMES = new Set(["apply_lut", "set_scratch_disk_path"]);

/** A conservative classification for centralized server registration. */
export function capabilityForTool(toolName: string): Capability {
  if (UNSAFE_TOOL_NAMES.has(toolName)) return "unsafe-script";
  if (/^(export_|start_batch_encode|queue_|encode_|capture_frame)/.test(toolName)) return "export";
  if (/^(import_|relink_|create_project|open_project|save_|consolidate_)/.test(toolName)) return "filesystem";
  if (FILESYSTEM_TOOL_NAMES.has(toolName)) return "filesystem";
  if (INSPECT_TOOL_NAMES.has(toolName) || /^(get_|list_|inspect_|find_|check_)/.test(toolName)) return "inspect";
  // Every remaining registered tool changes Premiere state. Defaulting to edit
  // keeps new tools fail-closed instead of silently bypassing the authority profile.
  return "edit";
}

export function guardToolHandler<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
  config: CapabilityConfig = resolveCapabilities(),
  createOperationId: () => string = randomUUID,
): (args: TArgs) => Promise<TResult> {
  const required = capabilityForTool(toolName);
  return async (args: TArgs) => {
    requireCapability(config, required, createOperationId());
    return handler(args);
  };
}
