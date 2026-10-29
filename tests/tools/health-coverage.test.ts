import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bridge/file-bridge.js")>();
  return { ...actual, sendCommand: vi.fn() };
});

vi.mock("../../src/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/telemetry.js")>();
  return { ...actual, captureActivationEvent: vi.fn() };
});

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHealthTools } from "../../src/tools/health.js";

const mockedSendCommand = vi.mocked(sendCommand);

afterEach(() => vi.clearAllMocks());

describe("health connection diagnostics", () => {
  it("selects connected UXP by default and reports it as active", async () => {
    const request = vi.fn().mockResolvedValue({ projectOpen: true, sequenceOpen: true });
    const uxpBridge = {
      request,
      getState: () => ({ status: "connected", connected: true }),
    } as any;
    const tools = getHealthTools(
      { tempDir: "/tmp/health" }, undefined, () => ({}), { uxpBridge },
    );

    await expect(tools.verify_premiere_connection.handler({})).resolves.toMatchObject({
      success: true,
      data: { backend: "uxp", bridgeSelection: { active: "uxp", checked: "uxp" } },
    });
    await expect(tools.get_capabilities.handler({})).resolves.toMatchObject({
      success: true,
      data: { bridge: { mode: "auto", active: "uxp", fallbackToCep: false } },
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("forces CEP through configuration while keeping UXP connected", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { projectOpen: true, sequenceOpen: true } });
    const uxpBridge = {
      request: vi.fn(),
      getState: () => ({ status: "connected", connected: true }),
    } as any;
    const result = await getHealthTools(
      { tempDir: "/tmp/health" }, undefined, undefined, { uxpBridge, bridgeMode: "cep" },
    ).verify_premiere_connection.handler({});

    expect(result).toMatchObject({
      success: true,
      data: { backend: "cep", bridgeSelection: { mode: "cep", active: "cep", checked: "cep" } },
    });
    expect(uxpBridge.request).not.toHaveBeenCalled();
  });

  it("falls back to CEP when the automatic read-only UXP probe disconnects", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { projectOpen: true, sequenceOpen: true } });
    const uxpBridge = {
      request: vi.fn().mockRejectedValue(new Error("panel disconnected")),
      getState: () => ({ status: "connected", connected: true }),
    } as any;
    const result = await getHealthTools(
      { tempDir: "/tmp/health" }, undefined, undefined, { uxpBridge },
    ).verify_premiere_connection.handler({});

    expect(result).toMatchObject({
      success: true,
      data: { backend: "cep", bridgeSelection: { requested: "auto", checked: "cep" } },
    });
    expect(mockedSendCommand).toHaveBeenCalledOnce();
  });

  it("returns an explicit local feature-support report and safely surfaces invalid version input", async () => {
    const tools = getHealthTools(
      { tempDir: "/tmp/health" },
      undefined,
      () => ({}),
    );
    await expect(tools.get_advanced_feature_support.handler({
      backend: "uxp",
      premiere_version: "26.3.0",
      frameio_entitled: true,
      generative_ai_entitled: true,
      network_available: true,
    })).resolves.toMatchObject({
      success: true,
      data: {
        context: { backend: "uxp", premiereVersion: "26.3.0" },
        features: { productions: { staticEligibility: { eligible: true } } },
      },
    });
    await expect(tools.get_advanced_feature_support.handler({
      premiere_version: "26.beta",
    })).resolves.toEqual({
      success: false,
      error: "premiere_version must contain only numeric version components",
    });
  });

  it("reports an unavailable UXP bridge without falling back to CEP", async () => {
    const telemetry = { enabled: true, capture: vi.fn(), shutdown: vi.fn() };
    const result = await getHealthTools({ tempDir: "/tmp/health" }, undefined, undefined, { telemetry })
      .verify_premiere_connection.handler({ backend: "uxp" });

    expect(result).toMatchObject({
      success: true,
      data: {
        backend: "uxp",
        overall: "needs_attention",
        components: expect.arrayContaining([
          expect.objectContaining({ id: "premiere_connector", state: "needs_attention" }),
        ]),
      },
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(telemetry.capture).not.toHaveBeenCalled();
  });

  it("treats a malformed UXP state response as a reachable host with no open project", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const result = await getHealthTools(
      { tempDir: "/tmp/health" },
      undefined,
      undefined,
      { uxpBridge: { request } as any },
    ).verify_premiere_connection.handler({ backend: "uxp" });

    expect(request).toHaveBeenCalledWith("state.get");
    expect(result).toMatchObject({
      success: true,
      data: {
        backend: "uxp",
        overall: "needs_attention",
        components: expect.arrayContaining([
          expect.objectContaining({ id: "premiere_connector", state: "ready" }),
          expect.objectContaining({ id: "active_project", state: "needs_attention" }),
          expect.objectContaining({ id: "active_sequence", state: "needs_attention" }),
        ]),
      },
    });
  });

  it("reports an unreachable UXP bridge when its read-only request rejects", async () => {
    const request = vi.fn().mockRejectedValue(new Error("panel closed"));
    const result = await getHealthTools(
      { tempDir: "/tmp/health" },
      undefined,
      undefined,
      { uxpBridge: { request } as any },
    ).verify_premiere_connection.handler({ backend: "uxp" });

    expect(result).toMatchObject({
      success: true,
      data: { backend: "uxp", overall: "needs_attention" },
    });
  });

  it("handles failed and thrown CEP probes as unavailable diagnostics", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "CEP unavailable" });
    const tools = getHealthTools({ tempDir: "/tmp/health" });
    await expect(tools.verify_premiere_connection.handler({ backend: "cep" }))
      .resolves.toMatchObject({ success: true, data: { backend: "cep", overall: "needs_attention" } });

    mockedSendCommand.mockRejectedValueOnce(new Error("bridge directory unreadable"));
    await expect(tools.verify_premiere_connection.handler({ backend: "cep" }))
      .resolves.toMatchObject({ success: true, data: { backend: "cep", overall: "needs_attention" } });
  });
});
