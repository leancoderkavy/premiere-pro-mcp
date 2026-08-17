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

  it("bounds growing-media pauses with a persisted lease and resumes on disposal", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };
    const project = {
      guid: "project-1", path: "C:/work/source.prproj",
      pauseGrowing: vi.fn(async () => true),
    };
    const timer = { callback: null as null | (() => void) };
    const runtime = NextWorkflows.createNextWorkflowRuntime({
      ppro: {
        Project: {
          getActiveProject: vi.fn(async () => project),
          getProject: vi.fn(() => project),
        },
        Guid: { fromString: vi.fn((value: string) => value) },
      },
      storage,
      now: () => 1000,
      setTimer: vi.fn((callback: () => void) => { timer.callback = callback; return 7; }),
      clearTimer: vi.fn(),
    });

    await expect(runtime.definitions["growing.pause"].handler({ leaseMs: 600000 })).rejects.toMatchObject({
      code: "UXP_CONFIRMATION_REQUIRED",
    });
    await expect(runtime.definitions["growing.pause"].handler({
      leaseMs: 5000, confirmPause: true,
    })).resolves.toMatchObject({
      paused: true, projectId: "project-1", leaseMs: 5000,
      outcome: "committed_unverified", verificationBoundary: "project_pauseGrowing_host_return_only",
    });
    expect(storage.setItem).toHaveBeenCalled();
    expect(timer.callback).toBeTypeOf("function");
    expect(runtime.definitions["growing.status"].handler({})).toMatchObject({
      pausedByThisPanel: true, projectId: "project-1", verificationBoundary: "panel_local_lease_only",
    });
    await expect(runtime.dispose()).resolves.toMatchObject({ resumed: true, reason: "panel_or_bridge_disconnect" });
    expect(project.pauseGrowing).toHaveBeenNthCalledWith(1, true);
    expect(project.pauseGrowing).toHaveBeenNthCalledWith(2, false);
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it("writes namespaced checkpoints in one transaction and verifies typed readback", async () => {
    const values = new Map<string, unknown>();
    const properties = {
      hasValue: vi.fn((key: string) => values.has(key)),
      getValue: vi.fn((key: string) => values.get(key)),
      getValueAsInt: vi.fn((key: string) => values.get(key)),
      getValueAsFloat: vi.fn((key: string) => values.get(key)),
      getValueAsBool: vi.fn((key: string) => values.get(key)),
      createSetValueAction: vi.fn((key: string, value: unknown) => ({ apply: () => values.set(key, value) })),
      createClearValueAction: vi.fn((key: string) => ({ apply: () => values.delete(key) })),
    };
    const project = {
      guid: "project-1",
      getActiveSequence: vi.fn(async () => null),
      lockedAccess: vi.fn((callback: () => void) => callback()),
      executeTransaction: vi.fn((callback: (compound: { addAction: (action: { apply: () => void }) => boolean }) => void) => {
        callback({ addAction: (action) => { action.apply(); return true; } });
        return true;
      }),
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        Properties: {
          getProperties: vi.fn(async () => properties),
          PROPERTY_PERSISTENT: 1,
          PROPERTY_NON_PERSISTENT: 2,
        },
      },
    });

    await expect(definitions["checkpoint.set"].handler({
      owner: "project", expectedOwnerId: "project-1", name: "render.pass",
      valueType: "int", value: 3, persistence: "persistent",
    })).resolves.toMatchObject({
      owner: "project", ownerId: "project-1", name: "render.pass",
      keyNamespace: "premiereMcp.", exists: true, valueType: "int", value: 3,
      persistence: "persistent", outcome: "verified", verificationBoundary: "typed_property_readback",
    });
    expect(properties.createSetValueAction).toHaveBeenCalledWith("premiereMcp.render.pass", 3, 1);
    await expect(definitions["checkpoint.get"].handler({
      name: "render.pass", valueType: "int",
    })).resolves.toMatchObject({ exists: true, value: 3 });
    await expect(definitions["checkpoint.clear"].handler({ name: "render.pass" })).resolves.toMatchObject({
      cleared: true, exists: false, verificationBoundary: "property_absence_readback",
    });
    expect(project.executeTransaction).toHaveBeenCalledTimes(2);
  });

  it("redacts media paths by default and verifies grouped offline actions", async () => {
    let offline = false;
    const clip = {
      name: "Camera A",
      getId: vi.fn(async () => "clip-1"),
      isOffline: vi.fn(async () => offline),
      canChangeMediaPath: vi.fn(async () => true),
      canProxy: vi.fn(async () => true),
      hasProxy: vi.fn(async () => true),
      isMergedClip: vi.fn(async () => false),
      isMulticamClip: vi.fn(async () => false),
      getMediaFilePath: vi.fn(async () => "C:/private/camera.mov"),
      getProxyPath: vi.fn(async () => "C:/private/proxy.mov"),
      getOriginatingProjectPath: vi.fn(async () => "C:/private/source.prproj"),
      createSetOfflineAction: vi.fn(() => ({ apply: () => { offline = true; } })),
    };
    const project = {
      guid: "project-1",
      lockedAccess: vi.fn((callback: () => void) => callback()),
      executeTransaction: vi.fn((callback: (compound: { addAction: (action: { apply: () => void }) => boolean }) => void) => {
        callback({ addAction: (action) => { action.apply(); return true; } });
        return true;
      }),
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        ProjectUtils: { getSelection: vi.fn(async () => ({ getItems: vi.fn(async () => [clip]) })) },
        ClipProjectItem: { cast: vi.fn((item: unknown) => item) },
      },
    });

    const inspected = await definitions["media.health.inspect"].handler({});
    expect(inspected).toMatchObject({
      count: 1, pathDisclosure: "redacted",
      items: [{ projectItemId: "clip-1", offline: false, hasProxy: true }],
    });
    expect(inspected.items[0]).not.toHaveProperty("mediaPath");
    await expect(definitions["media.health.setOffline"].handler({
      expectedOffline: false,
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    await expect(definitions["media.health.setOffline"].handler({
      expectedOffline: false, confirmSetOffline: true,
    })).resolves.toMatchObject({
      updated: 1, items: [{ projectItemId: "clip-1", offline: true }],
      outcome: "verified", verificationBoundary: "offline_state_readback",
    });
  });

  it("sets caption-track mute state through direct host promises and reads it back", async () => {
    let muted = false;
    const captionTrack = {
      id: 9, name: "English",
      getIndex: vi.fn(async () => 0),
      isMuted: vi.fn(async () => muted),
      setMute: vi.fn(async (value: boolean) => { muted = value; return true; }),
    };
    const sequence = {
      guid: "sequence-1",
      getVideoTrackCount: vi.fn(async () => 0),
      getAudioTrackCount: vi.fn(async () => 0),
      getCaptionTrackCount: vi.fn(async () => 1),
      getCaptionTrack: vi.fn(async () => captionTrack),
    };
    const project = {
      getActiveSequence: vi.fn(async () => sequence),
      getSequences: vi.fn(async () => [sequence]),
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: { Project: { getActiveProject: vi.fn(async () => project) } },
    });

    await expect(definitions["track.state.set"].handler({
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      mediaType: "caption", trackIndices: [0], muted: true, expectedMuted: false,
    })).resolves.toMatchObject({
      sequenceId: "sequence-1", mediaType: "caption", requested: 1, updated: 1, failed: 0,
      tracks: [{ mediaType: "caption", trackIndex: 0, beforeMuted: false, afterMuted: true, verified: true }],
      outcome: "verified", undoable: false, verificationBoundary: "per_track_mute_readback",
    });
    await expect(definitions["track.state.inspect"].handler({
      sequenceId: "sequence-1", mediaType: "all",
    })).resolves.toMatchObject({
      count: 1, tracks: [{ mediaType: "caption", trackIndex: 0, muted: true }],
    });
  });
});
