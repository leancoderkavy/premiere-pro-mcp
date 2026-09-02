import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Events = require("../../uxp-plugin/events.cjs");

describe("UXP host event journal", () => {
  it("maps only documented stable SnapEvent constants to passive timeline receipts", () => {
    const definitions = Events.createTimelineSnapEventDefinitions({
      EVENT_SNAP_TO_KEYFRAME: "snap-keyframe",
      EVENT_SNAP_TO_TRACKITEM: "snap-track-item",
      EVENT_SNAP_TO_GUIDES: "snap-guides",
      EVENT_SNAP_RAZOR_TO_PLAYHEAD: "snap-razor-playhead",
      EVENT_SNAP_RAZOR_TO_MARKER: "snap-razor-marker",
      EVENT_SNAP_PLAYHEAD_TO_TRACKITEM_EDGE: "snap-playhead-edge",
      UNDOCUMENTED_EVENT: "must-not-register",
    });

    expect(definitions).toEqual([
      { category: "timeline", name: "timeline.snap.keyframe", eventName: "snap-keyframe", stateInvalidating: false, coalesceKey: null },
      { category: "timeline", name: "timeline.snap.trackItem", eventName: "snap-track-item", stateInvalidating: false, coalesceKey: null },
      { category: "timeline", name: "timeline.snap.guides", eventName: "snap-guides", stateInvalidating: false, coalesceKey: null },
      { category: "timeline", name: "timeline.snap.razor.playhead", eventName: "snap-razor-playhead", stateInvalidating: false, coalesceKey: null },
      { category: "timeline", name: "timeline.snap.razor.marker", eventName: "snap-razor-marker", stateInvalidating: false, coalesceKey: null },
      { category: "timeline", name: "timeline.snap.playhead.trackItemEdge", eventName: "snap-playhead-edge", stateInvalidating: false, coalesceKey: null },
    ]);
    expect(Events.createTimelineSnapEventDefinitions({
      EVENT_SNAP_TO_KEYFRAME: 1,
      EVENT_SNAP_TO_TRACKITEM: "",
    })).toEqual([]);
    expect(Events.createTimelineSnapEventDefinitions(null)).toEqual([]);
  });

  it("filters timeline SnapEvent receipts without exposing host payload fields", () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    journal.recordHostEvent({
      category: "timeline",
      name: "timeline.snap.keyframe",
      detail: { state: 4, target: "private clip", path: "D:/private.prproj" },
    });

    expect(journal.list({ categories: ["timeline"], eventNames: ["timeline.snap.keyframe"] }))
      .toMatchObject({ events: [{ category: "timeline", name: "timeline.snap.keyframe", detail: { state: 4 } }] });
  });

  it("maps only documented root operation-boundary events and coalesces drag-over receipts", () => {
    const definitions = Events.createOperationBoundaryEventDefinitions({
      EVENT_CLIP_EXTEND_REACHED: "clip-extend-reached",
      EVENT_EFFECT_DRAG_OVER: "effect-drag-over",
      EVENT_EXPORT_MEDIA_COMPLETE: "already-handled-completion",
    });

    expect(definitions).toEqual([
      { category: "operation", name: "operation.clip.extend.reached", eventName: "clip-extend-reached", stateInvalidating: false, coalesceKey: null },
      { category: "operation", name: "operation.effect.drag.over", eventName: "effect-drag-over", stateInvalidating: false, coalesceKey: "operation.effect.drag.over" },
    ]);
    expect(Events.createOperationBoundaryEventDefinitions({
      EVENT_CLIP_EXTEND_REACHED: 1,
      EVENT_EFFECT_DRAG_OVER: "",
    })).toEqual([]);
    expect(Events.createOperationBoundaryEventDefinitions(null)).toEqual([]);

    const journal = Events.createEventJournal({ capacity: 16 });
    journal.recordHostEvent({
      category: "operation", name: definitions[1].name, coalesceKey: definitions[1].coalesceKey,
      detail: { state: 1, path: "D:/private.prproj" },
    });
    journal.recordHostEvent({
      category: "operation", name: definitions[1].name, coalesceKey: definitions[1].coalesceKey,
      detail: { state: 2, target: "private clip" },
    });
    expect(journal.list({ eventNames: ["operation.effect.drag.over"] })).toMatchObject({
      latestRevision: 2,
      events: [{ category: "operation", name: "operation.effect.drag.over", detail: { state: 2 }, coalesced: 1 }],
    });
  });

  it("keeps a bounded revisioned history and reports overflow", () => {
    let now = 1_700_000_000_000;
    const journal = Events.createEventJournal({ capacity: 16, now: () => now++ });
    for (let index = 0; index < 20; index += 1) {
      journal.append({ category: "project", name: "project.dirty", detail: { state: index } });
    }

    expect(journal.status()).toMatchObject({ capacity: 16, size: 16, latestRevision: 20, oldestRevision: 5, dropped: 4 });
    expect(journal.list({ afterRevision: 1, limit: 3 })).toMatchObject({
      overflow: true,
      dropped: 4,
      events: [
        { revision: 5, category: "project", name: "project.dirty" },
        { revision: 6 },
        { revision: 7 },
      ],
    });
  });

  it("coalesces consecutive noisy progress receipts without exposing raw fields", () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    journal.append({
      category: "encoder", name: "encoder.progress", coalesceKey: "encoder.progress",
      detail: { progress: 0.1, path: "D:/secret.mov" },
    });
    journal.append({
      category: "encoder", name: "encoder.progress", coalesceKey: "encoder.progress",
      detail: { progress: 0.8, projectName: "Private" },
    });

    expect(journal.list({})).toMatchObject({
      latestRevision: 2,
      events: [{ revision: 2, detail: { progress: 0.8 }, coalesced: 1 }],
    });
    expect(journal.list({ afterRevision: 1 })).toMatchObject({
      overflow: false,
      events: [{ revision: 2, coalesced: 1 }],
    });
  });

  it("returns immediately when a filtered cursor has fallen behind evicted history", async () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    for (let index = 0; index < 20; index += 1) {
      journal.append({ category: "project", name: "project.dirty", detail: { state: index } });
    }

    await expect(journal.wait({
      afterRevision: 1,
      categories: ["encoder"],
      timeoutMs: 60_000,
    })).resolves.toMatchObject({ overflow: true, timedOut: false, events: [] });
  });

  it("settles a pending filtered waiter as soon as its cursor history is evicted", async () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    for (let index = 0; index < 16; index += 1) {
      journal.append({ category: "project", name: "project.dirty", detail: { state: index } });
    }
    const pending = journal.wait({
      afterRevision: 1,
      categories: ["encoder"],
      timeoutMs: 60_000,
    });

    journal.append({ category: "project", name: "project.dirty" });
    journal.append({ category: "project", name: "project.dirty" });

    await expect(pending).resolves.toMatchObject({ overflow: true, timedOut: false, events: [] });
  });

  it("waits for a matching receipt and times out cleanly", async () => {
    vi.useFakeTimers();
    try {
      const journal = Events.createEventJournal({ capacity: 16 });
      const matching = journal.wait({ afterRevision: 0, categories: ["operation"], timeoutMs: 1000 });
      journal.append({ category: "project", name: "project.dirty" });
      journal.append({ category: "operation", name: "operation.import.complete", detail: { state: 0 } });
      await expect(matching).resolves.toMatchObject({
        timedOut: false,
        events: [{ category: "operation", name: "operation.import.complete", detail: { state: 0 } }],
      });

      const timeout = journal.wait({ afterRevision: 2, eventNames: ["encoder.complete"], timeoutMs: 500 });
      await vi.advanceTimersByTimeAsync(500);
      await expect(timeout).resolves.toMatchObject({ timedOut: true, events: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves pending waiters when the journal closes", async () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    const pending = journal.wait({ timeoutMs: 60000 });
    journal.close();
    await expect(pending).resolves.toMatchObject({ closed: true, events: [] });
  });

  it("attributes encoder events only while exactly one job is active", async () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    const first = journal.beginEncodeJob({ kind: "sequence", operationId: "encode-one" });
    journal.markEncodeAccepted(first.jobId);
    journal.recordHostEvent({ category: "encoder", name: "encoder.queued" });
    journal.recordHostEvent({ category: "encoder", name: "encoder.progress", detail: { progress: 0.5 } });

    expect(journal.listEncodeJobs({ jobId: first.jobId })).toMatchObject({
      correlation: "single-active-job-only",
      jobs: [{ jobId: "encode-one", state: "rendering", progress: 0.5, terminal: false }],
    });

    const terminal = journal.waitForEncodeJob({ jobId: first.jobId, timeoutMs: 1000 });
    journal.recordHostEvent({ category: "encoder", name: "encoder.complete" });
    await expect(terminal).resolves.toMatchObject({
      timedOut: false,
      job: { state: "completed", terminal: true, terminalReason: "completed" },
    });
  });

  it("does not guess job correlation when multiple encodes are active", () => {
    const journal = Events.createEventJournal({ capacity: 16 });
    journal.beginEncodeJob({ kind: "sequence", operationId: "encode-one" });
    journal.beginEncodeJob({ kind: "file", operationId: "encode-two" });
    const receipt = journal.recordHostEvent({ category: "encoder", name: "encoder.complete" });

    expect(receipt).toMatchObject({ detail: { attributed: false } });
    expect(journal.listEncodeJobs({})).toMatchObject({
      unattributedEncoderEvents: 1,
      jobs: expect.arrayContaining([
        expect.objectContaining({ jobId: "encode-one", terminal: false }),
        expect.objectContaining({ jobId: "encode-two", terminal: false }),
      ]),
    });
  });
});
