import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const protocol = require("../../uxp-plugin/protocol.cjs");

describe("UXP bridge protocol", () => {
  it("builds versioned envelopes", () => {
    const result = protocol.envelope("event", { name: "changed" }, "r1");
    expect(result).toMatchObject({ protocolVersion: 2, type: "event", requestId: "r1", payload: { name: "changed" } });
    expect(Date.parse(result.sentAt)).not.toBeNaN();
  });
  it("parses commands with safe defaults", () => {
    expect(protocol.parseCommand('{"type":"command","command":"state.get"}')).toEqual({ requestId: null, command: "state.get", args: {} });
  });
  it("rejects malformed commands", () => expect(() => protocol.parseCommand({ type: "event" })).toThrow("Invalid UXP bridge command"));
  it("rejects invalid protocol versions and argument shapes", () => {
    expect(() => protocol.parseCommand({ protocolVersion: 1, type: "command", command: "state.get" })).toThrow("Unsupported UXP protocol version");
    expect(() => protocol.parseCommand({ type: "command", command: "state.get", args: [] })).toThrow("args must be an object");
    expect(() => protocol.parseCommand({ type: "command", command: "../state" })).toThrow("Invalid UXP bridge command");
  });
  it("bounds request identifiers and command size", () => {
    expect(() => protocol.parseCommand({ type: "command", requestId: "", command: "state.get" })).toThrow("requestId");
    const oversized = JSON.stringify({ type: "command", command: "state.get", padding: "x".repeat(protocol.MAX_COMMAND_BYTES) });
    expect(() => protocol.parseCommand(oversized)).toThrow("64 KiB");
  });
  it("prevents filename path traversal", () => {
    expect(protocol.safeFilename("shot-01.png")).toBe("shot-01.png");
    expect(() => protocol.safeFilename("../shot.png")).toThrow();
    expect(() => protocol.safeFilename("shot.jpg")).toThrow();
  });
  it("joins Windows and POSIX-style output paths", () => {
    expect(protocol.joinPath("C:/temp", "a.png")).toBe("C:/temp/a.png");
    expect(protocol.joinPath("C:/temp/", "a.png")).toBe("C:/temp/a.png");
  });

  it("describes verification, undo, transaction, and cancellation boundaries", () => {
    expect(protocol.operationSemantics({
      mutatesProject: true,
      verificationStatus: "verified",
      verificationBoundary: "post_action_snapshot",
      verificationEvidence: [{ type: "sequence", id: "s1" }],
      undoSupported: true,
      undoLabel: "Rename track",
      transactionActionGroup: true,
      cancellationSupported: false,
    })).toEqual({
      mutatesProject: true,
      verification: {
        status: "verified",
        boundary: "post_action_snapshot",
        evidence: [{ type: "sequence", id: "s1" }],
      },
      undo: {
        supported: true,
        boundary: "premiere_undo_history",
        label: "Rename track",
      },
      transaction: {
        actionGroup: true,
        boundary: "project_executeTransaction",
        atomicRollback: false,
      },
      cancellation: {
        supported: false,
        boundary: "before_non_cancellable_host_call",
      },
    });
  });

  it("emits correlated operation lifecycle events", () => {
    expect(protocol.operationEvent(
      "progress",
      { requestId: "op-1", command: "frame.export" },
      { phase: "verification", progress: 0.8 },
    )).toMatchObject({
      protocolVersion: 2,
      type: "event",
      requestId: "op-1",
      payload: {
        name: "premiere.operation.progress",
        operation: {
          requestId: "op-1",
          command: "frame.export",
          phase: "verification",
          progress: 0.8,
        },
      },
    });
  });

  it("only accepts cancellation before a non-cancellable host call", () => {
    const tracker = protocol.createOperationTracker();
    const operation = tracker.begin("op-1", "frame.export");
    expect(tracker.requestCancel("op-1")).toEqual({
      accepted: true,
      reason: "cancellation_requested",
    });
    tracker.finish(operation);
    expect(tracker.requestCancel("op-1")).toEqual({
      accepted: false,
      reason: "operation_not_active",
    });

    const inHost = tracker.begin("op-2", "frame.export");
    inHost.phase = "host_call";
    expect(tracker.requestCancel("op-2")).toEqual({
      accepted: false,
      reason: "host_call_not_cancellable",
    });
  });
});
