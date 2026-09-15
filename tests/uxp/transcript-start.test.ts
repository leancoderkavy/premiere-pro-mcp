import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

function fixture(accepted = true, duplicateName = false) {
  const clip = { name: "Interview", getId: () => "clip-1" };
  const other = { name: "Interview", getId: () => "clip-2" };
  const bin = { getItems: async () => duplicateName ? [clip, other] : [clip] };
  const root = { getItems: async () => [bin] };
  const transcribe = vi.fn(async () => accepted);
  const ppro = {
    Project: { getActiveProject: async () => ({ getRootItem: async () => root }) },
    ClipProjectItem: { cast: (item: unknown) => item === clip || item === other ? item : null },
    FolderItem: { cast: (item: unknown) => item === root || item === bin ? item : null },
    Transcript: { transcribeClipProjectItem: transcribe },
  };
  return { clip, transcribe, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

const input = { projectItemId: "clip-1", confirmDestructive: true, operationId: "start-1" };

describe("guarded transcription start", () => {
  it("resolves the exact nested clip and passes Adobe's language options object once", async () => {
    const { registry, clip, transcribe } = fixture();
    const args = { ...input, language: " en-US " };
    await expect(registry.dispatch("transcript.start", args)).resolves.toMatchObject({
      started: true, projectItemId: "clip-1", language: "en-US", outcome: "committed_unverified",
    });
    expect(transcribe).toHaveBeenCalledWith(clip, { language: "en-US" });
    await expect(registry.dispatch("transcript.start", args)).resolves.toMatchObject({ replayed: true });
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("leaves language preferences to Adobe when no language is supplied", async () => {
    const { registry, clip, transcribe } = fixture();
    await registry.dispatch("transcript.start", input);
    expect(transcribe).toHaveBeenCalledWith(clip, undefined);
  });

  it("does not claim a start when Adobe returns false", async () => {
    const { registry } = fixture(false);
    await expect(registry.dispatch("transcript.start", input)).rejects.toMatchObject({ code: "UXP_VERIFICATION_FAILED" });
  });

  it("rejects ambiguous clip names before invoking Adobe", async () => {
    const { registry, transcribe } = fixture(true, true);
    await expect(registry.dispatch("transcript.start", { ...input, projectItemId: undefined, projectItemName: "Interview" }))
      .rejects.toMatchObject({ code: "UXP_AMBIGUOUS_TARGET" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("requires confirmation before invoking Adobe", async () => {
    const { registry, transcribe } = fixture();
    await expect(registry.dispatch("transcript.start", { ...input, confirmDestructive: false }))
      .rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    expect(transcribe).not.toHaveBeenCalled();
  });
});
