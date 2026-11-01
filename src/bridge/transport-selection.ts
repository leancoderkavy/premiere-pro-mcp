import type { UxpWebSocketBridge } from "./uxp-websocket-bridge.js";

export type PremiereBridgeMode = "auto" | "cep";
export type PremiereBridgeBackend = "uxp" | "cep";

export function resolvePremiereBridgeMode(value = process.env.PREMIERE_BRIDGE_MODE): PremiereBridgeMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "cep") return "cep";
  throw new Error("PREMIERE_BRIDGE_MODE must be either auto or cep.");
}

export function isUxpConnected(bridge?: UxpWebSocketBridge): boolean {
  return Boolean(bridge && typeof bridge.getState === "function" && bridge.getState().connected === true);
}

export function selectPremiereBridge(
  mode: PremiereBridgeMode,
  bridge?: UxpWebSocketBridge,
): PremiereBridgeBackend {
  return mode === "auto" && isUxpConnected(bridge) ? "uxp" : "cep";
}

export function bridgeSelectionStatus(mode: PremiereBridgeMode, bridge?: UxpWebSocketBridge) {
  const uxpConnected = isUxpConnected(bridge);
  const active = selectPremiereBridge(mode, bridge);
  return {
    mode,
    active,
    uxpConfigured: bridge !== undefined,
    uxpConnected,
    fallbackToCep: mode === "auto" && !uxpConnected,
    note: mode === "cep"
      ? "CEP is forced by configuration."
      : active === "uxp"
        ? "UXP is connected and selected by default. Failed UXP mutations are never retried through CEP."
        : "UXP is not connected; new automatic bridge selections use CEP.",
  };
}
