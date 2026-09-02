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
      getMedia: vi.fn(async () => ({ start: { seconds: 2 }, duration: { seconds: 5 } })),
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
    expect(inspected.items[0]).not.toHaveProperty("mediaTiming");
    expect(clip.getMedia).not.toHaveBeenCalled();
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

  it("reads opt-in media timing through stable properties, including beta promise-shape compatibility", async () => {
    let media: Record<string, unknown> = {
      start: { seconds: 1.25 },
      duration: { seconds: 9.5 },
    };
    const clip = {
      name: "Camera A",
      getId: vi.fn(async () => "clip-1"),
      isOffline: vi.fn(async () => false),
      canChangeMediaPath: vi.fn(async () => true),
      canProxy: vi.fn(async () => true),
      hasProxy: vi.fn(async () => false),
      isMergedClip: vi.fn(async () => false),
      isMulticamClip: vi.fn(async () => false),
      getMedia: vi.fn(async () => media),
    };
    const project = { guid: "project-1" };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        ProjectUtils: { getSelection: vi.fn(async () => ({ getItems: vi.fn(async () => [clip]) })) },
        ClipProjectItem: { cast: vi.fn((item: unknown) => item) },
      },
    });

    await expect(definitions["media.health.inspect"].handler({ includeMediaTiming: true })).resolves.toMatchObject({
      items: [{
        mediaTiming: {
          available: true,
          startSeconds: 1.25,
          durationSeconds: 9.5,
          startAccessor: "start",
          durationAccessor: "duration",
        },
      }],
    });

    const betaPropertyMedia = {
      getStart: vi.fn(async () => ({ seconds: 99 })),
      getDuration: vi.fn(async () => ({ seconds: 99 })),
      start: Promise.resolve({ seconds: 3 }),
      duration: Promise.resolve({ seconds: 12 }),
    };
    media = betaPropertyMedia;
    await expect(definitions["media.health.inspect"].handler({ includeMediaTiming: true })).resolves.toMatchObject({
      items: [{
        mediaTiming: {
          available: true,
          startSeconds: 3,
          durationSeconds: 12,
          startAccessor: "start",
          durationAccessor: "duration",
        },
      }],
    });
    expect(betaPropertyMedia.getStart).not.toHaveBeenCalled();
    expect(betaPropertyMedia.getDuration).not.toHaveBeenCalled();

    const failedPropertyMedia = {
      getStart: vi.fn(async () => ({ seconds: 99 })),
      getDuration: vi.fn(async () => ({ seconds: 99 })),
      get start() { throw new Error("start unavailable"); },
      duration: { seconds: 7 },
    };
    media = failedPropertyMedia;
    await expect(definitions["media.health.inspect"].handler({ includeMediaTiming: true })).resolves.toMatchObject({
      items: [{
        mediaTiming: {
          available: false,
          startSeconds: null,
          durationSeconds: 7,
          startAccessor: "start",
          durationAccessor: "duration",
        },
      }],
    });
    expect(failedPropertyMedia.getStart).not.toHaveBeenCalled();
    expect(failedPropertyMedia.getDuration).not.toHaveBeenCalled();

    media = { start: { seconds: -1 }, duration: { seconds: 86400001 } };
    await expect(definitions["media.health.inspect"].handler({ includeMediaTiming: true })).resolves.toMatchObject({
      items: [{
        mediaTiming: {
          available: false,
          startSeconds: null,
          durationSeconds: null,
          startAccessor: "start",
          durationAccessor: "duration",
        },
      }],
    });
    await expect(definitions["media.health.inspect"].handler({ includeMediaTiming: "yes" })).rejects.toMatchObject({
      code: "UXP_INVALID_ARGUMENT",
    });
  });

  it("guards, serializes, replays, and reads back a source-media start-time action", async () => {
    let startSeconds = 10, durationSeconds = 60;
    const media = {
      get start() { return { seconds: startSeconds }; },
      get duration() { return { seconds: durationSeconds }; },
      createSetStartAction: vi.fn((time: { seconds: number }) => ({
        apply: () => {
          startSeconds = time.seconds;
          if (time.seconds === 16) durationSeconds = 59;
        },
      })),
    };
    const clip = {
      getId: vi.fn(async () => "clip-1"),
      getMedia: vi.fn(async () => media),
    };
    const root = { getItems: vi.fn(async () => [clip]) };
    const project = {
      guid: "project-1",
      getRootItem: vi.fn(async () => root),
      lockedAccess: vi.fn((callback: () => void) => callback()),
      executeTransaction: vi.fn((callback: (compound: { addAction: (action: { apply: () => void }) => boolean }) => void) => {
        callback({ addAction: (action) => { action.apply(); return true; } });
        return true;
      }),
    };
    const ppro = {
      Project: { getActiveProject: vi.fn(async () => project) },
      ProjectItem: { cast: vi.fn((item: unknown) => item) },
      ClipProjectItem: { cast: vi.fn((item: unknown) => item) },
      FolderItem: { cast: vi.fn(() => null) },
      TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    };
    const registry = Commands.createCommandRegistry({ ppro, Protocol });

    await expect(registry.dispatch("source.mediaTiming.inspect", { projectItemId: "clip-1" })).resolves.toEqual({
      projectItemId: "clip-1", startSeconds: 10, durationSeconds: 60,
      verificationBoundary: "source_media_timing_readback",
    });
    await expect(registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 10, durationSeconds: 60 }, startSeconds: 12,
    })).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    expect(media.createSetStartAction).not.toHaveBeenCalled();
    await expect(registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 10 }, startSeconds: 12, confirmSetStart: true,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    expect(media.createSetStartAction).not.toHaveBeenCalled();

    const firstArgs = {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 10, durationSeconds: 60 },
      startSeconds: 12, confirmSetStart: true, operationId: "source-start-1",
    };
    await expect(registry.dispatch("source.mediaTiming.setStart", firstArgs)).resolves.toMatchObject({
      updated: true, projectItemId: "clip-1", outcome: "verified", operationId: "source-start-1",
      before: { startSeconds: 10, durationSeconds: 60 }, after: { startSeconds: 12, durationSeconds: 60 },
    });
    expect(project.executeTransaction).toHaveBeenCalledWith(expect.any(Function), "Set source media start time");
    await expect(registry.dispatch("source.mediaTiming.setStart", firstArgs)).resolves.toMatchObject({
      replayed: true, operationId: "source-start-1",
    });
    expect(media.createSetStartAction).toHaveBeenCalledTimes(1);

    const expectedTiming = { startSeconds: 12, durationSeconds: 60 };
    const concurrentFirst = registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming, startSeconds: 15, confirmSetStart: true, operationId: "source-start-2",
    });
    const concurrentSecond = registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming, startSeconds: 18, confirmSetStart: true, operationId: "source-start-3",
    });
    await expect(concurrentFirst).resolves.toMatchObject({
      updated: true, after: { startSeconds: 15, durationSeconds: 60 }, operationId: "source-start-2",
    });
    await expect(concurrentSecond).rejects.toMatchObject({ code: "UXP_STALE_TARGET" });
    expect(media.createSetStartAction).toHaveBeenCalledTimes(2);
    expect(project.executeTransaction).toHaveBeenCalledTimes(2);
    expect(startSeconds).toBe(15);

    await expect(registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 12, durationSeconds: 60 },
      startSeconds: 19, confirmSetStart: true,
    })).rejects.toMatchObject({ code: "UXP_STALE_TARGET" });
    expect(media.createSetStartAction).toHaveBeenCalledTimes(2);

    await expect(registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 15, durationSeconds: 60 },
      startSeconds: 16, confirmSetStart: true, operationId: "source-start-4",
    })).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });
    expect(project.executeTransaction).toHaveBeenCalledTimes(3);
    expect(startSeconds).toBe(16);
    expect(durationSeconds).toBe(59);

    const betaPromiseMedia = {
      start: Promise.resolve({ seconds: 16 }),
      duration: Promise.resolve({ seconds: 59 }),
      createSetStartAction: vi.fn(),
    };
    clip.getMedia.mockResolvedValue(betaPromiseMedia);
    await expect(registry.dispatch("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 16, durationSeconds: 59 },
      startSeconds: 19, confirmSetStart: true,
    })).rejects.toMatchObject({ code: "UXP_COMMAND_UNAVAILABLE" });
    expect(betaPromiseMedia.createSetStartAction).not.toHaveBeenCalled();
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

  it("commits source trim actions together, verifies time readback, and withholds scale verification", async () => {
    let inSeconds = 1, outSeconds = 9;
    const clip = {
      name: "Camera A",
      getId: vi.fn(() => "clip-1"),
      getInPoint: vi.fn(async () => ({ seconds: inSeconds })),
      getOutPoint: vi.fn(async () => ({ seconds: outSeconds })),
      createSetInOutPointsAction: vi.fn((inPoint: { seconds: number }, outPoint: { seconds: number }) => ({
        apply: () => { inSeconds = inPoint.seconds; outSeconds = outPoint.seconds; },
      })),
      createSetInPointAction: vi.fn(),
      createSetOutPointAction: vi.fn(),
      createClearInOutPointsAction: vi.fn(),
      createSetScaleToFrameSizeAction: vi.fn(() => ({ apply: () => undefined })),
    };
    const root = { getItems: vi.fn(async () => [clip]) };
    const project = {
      getRootItem: vi.fn(async () => root),
      lockedAccess: vi.fn((callback: () => void) => callback()),
      executeTransaction: vi.fn((callback: (compound: { addAction: (action: { apply: () => void }) => boolean }) => void) => {
        callback({ addAction: (action) => { action.apply(); return true; } });
        return true;
      }),
    };
    const definitions = NextWorkflows.createNextWorkflowDefinitions({
      ppro: {
        Project: { getActiveProject: vi.fn(async () => project) },
        ClipProjectItem: { cast: vi.fn((item: unknown) => item) },
        ProjectItem: { cast: vi.fn((item: unknown) => item) },
        FolderItem: { cast: vi.fn(() => null) },
        TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
        Constants: { MediaType: { VIDEO: 1, AUDIO: 2 } },
      },
    });

    await expect(definitions["source.clip.update"].handler({
      items: [{
        projectItemId: "clip-1", mediaType: "video", expectedInSeconds: 1, expectedOutSeconds: 9,
        inSeconds: 2, outSeconds: 8,
      }],
    })).resolves.toMatchObject({
      updated: 1, outcome: "verified", verificationBoundary: "source_in_out_readback",
      items: [{ after: { inSeconds: 2, outSeconds: 8 }, trimVerified: true, scaleToFrameRequested: false }],
    });
    await expect(definitions["source.clip.update"].handler({
      items: [{ projectItemId: "clip-1", mediaType: "video", scaleToFrame: true }],
    })).resolves.toMatchObject({
      outcome: "committed_unverified",
      verificationBoundary: "transaction_commit_with_missing_clear_or_scale_getter",
      items: [{ scaleToFrameRequested: true, scaleToFrameVerified: false }],
    });
    expect(project.executeTransaction).toHaveBeenCalledTimes(2);
  });
});
