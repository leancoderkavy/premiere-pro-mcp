export const MAX_BRIDGE_SCRIPT_BYTES = 500 * 1024;

export function validateBridgeScriptSize(script: string): void {
  if (Buffer.byteLength(script, "utf-8") > MAX_BRIDGE_SCRIPT_BYTES) {
    throw new Error("Script exceeds 500KB size limit");
  }
}
