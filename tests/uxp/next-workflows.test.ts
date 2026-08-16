import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Events = require("../../uxp-plugin/events.cjs");
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
});
