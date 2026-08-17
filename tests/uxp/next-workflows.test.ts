import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Events = require("../../uxp-plugin/events.cjs");
const NextWorkflows = require("../../uxp-plugin/next-workflows.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function registry() {
  const events = Events.createEventJournal({ capacity: 16 });
  const ppro = { Project: { getActiveProject: vi.fn(async () => null) } };
  return { events, registry: Commands.createCommandRegistry({ ppro, Protocol, events }) };
}

describe("next-wave UXP event workflows", () => {
  it("advertises event listing only when a journal is present", async () => {
    await expect(registry().registry.capabilities()).resolves.toMatchObject({
      commands: {
        "events.list": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
        "events.wait": { supported: true, readOnly: true, minHostVersion: "25.6.0" },
      },
    });
    const withoutEvents = Commands.createCommandRegistry({
      ppro: { Project: { getActiveProject: vi.fn(async () => null) } }, Protocol,
    });
    await expect(withoutEvents.capabilities()).resolves.toMatchObject({
      commands: { "events.list": { supported: false } },
    });
  });

  it("lists and filters safe host receipts", async () => {
    const value = registry();
    value.events.append({ category: "project", name: "project.dirty" });
    value.events.append({ category: "encoder", name: "encoder.complete" });
    await expect(value.registry.dispatch("events.list", {
      afterRevision: 0, categories: ["encoder"], limit: 10,
    })).resolves.toMatchObject({
      latestRevision: 2,
      events: [{ revision: 2, category: "encoder", name: "encoder.complete" }],
    });
  });

  it("rejects unbounded and unexpected event-query arguments", async () => {
    const value = registry();
    await expect(value.registry.dispatch("events.wait", { timeoutMs: 60001 })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("events.list", { rawPayload: true })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
  });

  it("waits adaptively for sequence video-effect analysis readback", async () => {
    let clock = 0;
    const sequence = {
      guid: "sequence-1",
      isDoneAnalyzingForVideoEffects: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const project = {
      getActiveSequence: vi.fn(async () => sequence),
      getSequences: vi.fn(async () => [sequence]),
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: { Project: { getActiveProject: vi.fn(async () => project) } },
      events: Events.createEventJournal({ capacity: 16 }),
      now: () => clock,
      sleep: vi.fn(async (milliseconds: number) => { clock += milliseconds; }),
    });

    await expect(definitions["readiness.analysis.wait"].handler({
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      timeoutMs: 1000, pollMinMs: 100, pollMaxMs: 500,
    })).resolves.toMatchObject({
      ready: true, timedOut: false, sequenceId: "sequence-1", checks: 2,
      elapsedMs: 100, verificationBoundary: "sequence_analysis_readback",
    });
  });

  it("requires a pre-dispatch revision and classifies operation completion state", async () => {
    const events = Events.createEventJournal({ capacity: 16 });
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => null) },
        Constants: { OperationCompleteState: { SUCCESS: 0, CANCELLED: 1, FAILED: 2 } },
      },
      events,
    });
    await expect(definitions["readiness.operation.wait"].handler({
      operationType: "import", timeoutMs: 0,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });

    const before = events.status().latestRevision;
    events.recordHostEvent({
      category: "operation", name: "operation.import.complete", detail: { state: 0 },
    });
    await expect(definitions["readiness.operation.wait"].handler({
      operationType: "import", afterRevision: before, timeoutMs: 0,
    })).resolves.toMatchObject({
      ready: true, timedOut: false, outcome: "completed",
      receipt: { name: "operation.import.complete", detail: { state: 0 } },
      verificationBoundary: "operation_terminal_event_only",
    });
  });

  it("deduplicates project views, redacts paths by default, and verifies Save As retargeting", async () => {
    const project = {
      guid: "project-1", name: "Edit", path: "C:/work/source.prproj",
      saveAs: vi.fn(async (path: string) => { project.path = path; return true; }),
    };
    const ppro = {
      ProjectUtils: {
        getProjectViewIds: vi.fn(async () => ["view-1", "view-2"]),
        getProjectFromViewId: vi.fn(async () => project),
      },
      Project: {
        getActiveProject: vi.fn(async () => project),
        getProject: vi.fn(() => project),
        open: vi.fn(), createProject: vi.fn(), isProject: vi.fn(() => false),
      },
      Guid: { fromString: vi.fn((value: string) => value) },
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro,
      events: Events.createEventJournal({ capacity: 16 }),
      workspace: { assertPathAllowed: vi.fn(async (path: string) => path) },
    });

    await expect(definitions["project.sessions.list"].handler({})).resolves.toEqual({
      count: 1,
      activeProjectId: "project-1",
      projects: [{ projectId: "project-1", name: "Edit", hasPath: true }],
      pathDisclosure: "redacted",
    });
    await expect(definitions["project.sessions.saveAs"].handler({
      path: "C:/work/branch.prproj",
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(definitions["project.sessions.saveAs"].handler({
      path: "C:/work/branch.prproj", expectedPath: "C:/work/source.prproj",
      confirmExternalWrite: true,
    })).resolves.toMatchObject({
      action: "saved_as", projectId: "project-1", path: "C:/work/branch.prproj",
      outcome: "verified", verificationBoundary: "project_path_readback",
    });
  });
});
