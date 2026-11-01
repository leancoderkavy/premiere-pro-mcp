import { describe, expect, it } from "vitest";
import {
  bridgeSelectionStatus,
  resolvePremiereBridgeMode,
  selectPremiereBridge,
} from "../../src/bridge/transport-selection.js";

const bridge = (connected: boolean) => ({
  getState: () => connected
    ? { status: "connected", connected: true }
    : { status: "listening", connected: false },
}) as any;

describe("Premiere bridge selection", () => {
  it("prefers a connected UXP bridge in auto mode", () => {
    expect(selectPremiereBridge("auto", bridge(true))).toBe("uxp");
    expect(bridgeSelectionStatus("auto", bridge(true))).toMatchObject({
      active: "uxp", uxpConnected: true, fallbackToCep: false,
    });
  });

  it("falls back to CEP when UXP is absent or disconnected", () => {
    expect(selectPremiereBridge("auto")).toBe("cep");
    expect(bridgeSelectionStatus("auto", bridge(false))).toMatchObject({
      active: "cep", uxpConfigured: true, uxpConnected: false, fallbackToCep: true,
    });
  });

  it("forces CEP even when UXP is connected", () => {
    expect(selectPremiereBridge("cep", bridge(true))).toBe("cep");
    expect(bridgeSelectionStatus("cep", bridge(true))).toMatchObject({
      mode: "cep", active: "cep", fallbackToCep: false,
    });
  });

  it("parses only supported environment values", () => {
    expect(resolvePremiereBridgeMode(undefined)).toBe("auto");
    expect(resolvePremiereBridgeMode(" AUTO ")).toBe("auto");
    expect(resolvePremiereBridgeMode("cep")).toBe("cep");
    expect(() => resolvePremiereBridgeMode("uxp-only")).toThrow(/auto or cep/);
  });
});
