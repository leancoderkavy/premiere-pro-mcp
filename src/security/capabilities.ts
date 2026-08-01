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

const INSPECT_TOOL_NAMES = new Set([
  "ping",
  "get_capabilities",
  "preview_edit_plan",
  "preview_transcript_edit_uxp",
]);
// detect_silence reads a media file from disk and shells out to ffmpeg. It
// changes nothing in Premiere, so classifying it as "edit" would overstate what
// it does; filesystem is the authority it actually needs.
const FILESYSTEM_TOOL_NAMES = new Set(["apply_lut", "set_scratch_disk_path", "verify_delivery_file", "detect_silence"]);

/** A conservative classification for centralized server registration. */
export function capabilityForTool(toolName: string): Capability {
  if (UNSAFE_TOOL_NAMES.has(toolName)) return "unsafe-script";
  if (/^(export_|validate_export_|start_batch_encode|queue_|encode_|capture_frame)/.test(toolName)) return "export";
  if (/^(import_|relink_|create_project|open_project|save_|consolidate_)/.test(toolName)) return "filesystem";
  if (FILESYSTEM_TOOL_NAMES.has(toolName)) return "filesystem";
  if (INSPECT_TOOL_NAMES.has(toolName) || /^(get_|list_|inspect_|find_|check_)/.test(toolName)) return "inspect";
  // Every remaining registered tool changes Premiere state. Defaulting to edit
  // keeps new tools fail-closed instead of silently bypassing the authority profile.
  return "edit";
}

/**
 * Tools that stay advertised under every profile, because they are how an
 * operator diagnoses a profile that is too narrow: get_capabilities reports the
 * active authority, and ping proves the bridge is alive. Withholding them makes
 * a misconfigured server look broken with no supported way to ask why.
 */
export const ALWAYS_LISTED_TOOL_NAMES = new Set(["ping", "get_capabilities"]);

/**
 * Whether a tool should appear in tools/list under the given profile.
 *
 * This is an advertising decision, not an enforcement one — guardToolHandler
 * remains the authority check at call time. Keeping the two separate means a
 * listing bug can never widen what a profile is actually allowed to do.
 */
export function isToolPermitted(
  toolName: string,
  config: CapabilityConfig,
): boolean {
  if (ALWAYS_LISTED_TOOL_NAMES.has(toolName)) return true;
  return config.capabilities.has(capabilityForTool(toolName));
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
