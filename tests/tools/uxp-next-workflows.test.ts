import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getUxpNextWorkflowTools } from "../../src/tools/uxp-next-workflows.js";

describe("next-wave UXP MCP tools", () => {
  it("publishes a closed and bounded event receipt schema", () => {
    const bridge = { request: vi.fn(), getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["list", "wait"] },
        after_revision: { maximum: Number.MAX_SAFE_INTEGER },
        categories: { maxItems: 32 },
        event_names: { maxItems: 32 },
        limit: { maximum: 256 },
        timeout_ms: { maximum: 60000 },
      },
    });
    const readiness = getUxpNextWorkflowTools(bridge).wait_for_host_readiness_uxp;
    expect(readiness.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["snapshot", "analysis", "operation"] },
        operation_type: { enum: ["import", "export", "effect_drop", "generative_extend"] },
        after_revision: { maximum: Number.MAX_SAFE_INTEGER },
        timeout_ms: { maximum: 60000 },
        poll_max_ms: { maximum: 5000 },
      },
    });
    const projects = getUxpNextWorkflowTools(bridge).manage_project_sessions_uxp;
    expect(projects.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["list", "validate", "create", "open", "save", "save_as", "branch_copies", "close"] },
        paths: { maxItems: 16, uniqueItems: true },
        confirm_external_write: { type: "boolean" },
        confirm_discard_unsaved: { type: "boolean" },
      },
    });
  });

  it("maps snake-case event queries to the exact bridge commands", async () => {
    const request = vi.fn().mockResolvedValue({ events: [] });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    await tool.handler({
      action: "wait", after_revision: 7, categories: ["encoder"],
      event_names: ["encoder.complete"], limit: 4, timeout_ms: 5000,
    });
    expect(request).toHaveBeenCalledWith("events.wait", {
      afterRevision: 7,
      categories: ["encoder"],
      eventNames: ["encoder.complete"],
      limit: 4,
      timeoutMs: 5000,
    }, { minimumTimeoutMs: 10000 });

    const readiness = getUxpNextWorkflowTools(bridge).wait_for_host_readiness_uxp;
    await readiness.handler({
      action: "analysis", sequence_id: "sequence-1", expected_sequence_id: "sequence-1",
      timeout_ms: 10000, poll_min_ms: 100, poll_max_ms: 1000,
    });
    expect(request).toHaveBeenLastCalledWith("readiness.analysis.wait", {
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      timeoutMs: 10000, pollMinMs: 100, pollMaxMs: 1000,
    }, { minimumTimeoutMs: 15000 });

    await readiness.handler({
      action: "operation", operation_type: "effect_drop", after_revision: 9, timeout_ms: 5000,
    });
    expect(request).toHaveBeenLastCalledWith("readiness.operation.wait", {
      operationType: "effectDrop", afterRevision: 9, timeoutMs: 5000,
    }, { minimumTimeoutMs: 10000 });

    const projects = getUxpNextWorkflowTools(bridge).manage_project_sessions_uxp;
    await projects.handler({
      action: "branch_copies", project_id: "project-1", expected_path: "C:/work/source.prproj",
      paths: ["C:/work/a.prproj", "C:/work/b.prproj"], confirm_external_write: true,
      confirm_overwrite: false, operation_id: "branches-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.branchCopies", {
      projectId: "project-1", expectedPath: "C:/work/source.prproj", operationId: "branches-1",
      paths: ["C:/work/a.prproj", "C:/work/b.prproj"],
      confirmExternalWrite: true, confirmOverwrite: false,
    });
  });

  it("covers bounded event and readiness fallbacks without hiding bridge errors", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpNextWorkflowTools(bridge);

    await tools.inspect_premiere_events_uxp.handler({ action: "list" });
    expect(request).toHaveBeenLastCalledWith("events.list", {});
    await tools.inspect_premiere_events_uxp.handler({
      action: "list",
      after_revision: 0,
      categories: [],
      event_names: [],
      limit: 1,
      timeout_ms: 10,
    });
    expect(request).toHaveBeenLastCalledWith("events.list", {
      afterRevision: 0,
      categories: [],
      eventNames: [],
      limit: 1,
    });
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported event action: unsupported" });

    request.mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "wait" }))
      .resolves.toEqual({ success: false, error: "bridge unavailable" });
    request.mockRejectedValueOnce("plain failure");
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "wait", timeout_ms: 0 }))
      .resolves.toEqual({ success: false, error: "plain failure" });

    await tools.wait_for_host_readiness_uxp.handler({ action: "snapshot" });
    expect(request).toHaveBeenLastCalledWith("readiness.snapshot", {});
    await tools.wait_for_host_readiness_uxp.handler({ action: "snapshot", sequence_id: "sequence-1" });
    expect(request).toHaveBeenLastCalledWith("readiness.snapshot", { sequenceId: "sequence-1" });
    await tools.wait_for_host_readiness_uxp.handler({ action: "analysis" });
    expect(request).toHaveBeenLastCalledWith(
      "readiness.analysis.wait", {}, { minimumTimeoutMs: 35000 },
    );
    await tools.wait_for_host_readiness_uxp.handler({ action: "operation" });
    expect(request).toHaveBeenLastCalledWith(
      "readiness.operation.wait", {}, { minimumTimeoutMs: 35000 },
    );
    await expect(tools.wait_for_host_readiness_uxp.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported readiness action: unsupported" });
  });
});
