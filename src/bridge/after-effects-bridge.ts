import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sendCommand,
  type BridgeHelpers,
  type BridgeOptions,
  type CommandResult,
} from "./file-bridge.js";
import {
  afterEffectsHelpersFileName,
  buildAfterEffectsBootstrap,
  getAfterEffectsHelpersSource,
} from "./after-effects-script-builder.js";

export const AFTER_EFFECTS_TEMP_DIR_ENV = "AFTER_EFFECTS_MCP_TEMP_DIR";
export const AFTER_EFFECTS_DEFAULT_TEMP_DIR_NAME = "after-effects-mcp-bridge";

export const AFTER_EFFECTS_BRIDGE_HELPERS: BridgeHelpers = {
  source: getAfterEffectsHelpersSource(),
  fileName: afterEffectsHelpersFileName(),
  buildBootstrap: buildAfterEffectsBootstrap,
};

export function getAfterEffectsTempDir(
  configured = process.env[AFTER_EFFECTS_TEMP_DIR_ENV],
  fallback = tmpdir(),
): string {
  return configured?.trim() || join(fallback, AFTER_EFFECTS_DEFAULT_TEMP_DIR_NAME);
}

/**
 * Routes only to the dedicated AE bridge directory. Never reuse the Premiere
 * channel: both CEP panels may be open in the same logged-in desktop session.
 */
export function sendAfterEffectsCommand(
  script: string,
  options: BridgeOptions = {},
): Promise<CommandResult> {
  // `BridgeOptions` is also used by Premiere callers.  Its tempDir is therefore
  // deliberately ignored here: an explicit Premiere bridge directory must never
  // become the AE request/response channel.
  const { tempDir: _premiereTempDir, ...afterEffectsOptions } = options;
  return sendCommand(script, {
    ...afterEffectsOptions,
    tempDir: getAfterEffectsTempDir(),
    helpers: AFTER_EFFECTS_BRIDGE_HELPERS,
  });
}
