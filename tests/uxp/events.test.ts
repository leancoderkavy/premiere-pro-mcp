import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Events = require("../../uxp-plugin/events.cjs");

describe("UXP host event journal", () => {
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
});
