import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");
const Transcript = require("../../uxp-plugin/transcript.cjs");
const TranscriptImport = require("../../uxp-plugin/transcript-import.cjs");

const beforeJson = '{"segments":[{"text":"before"}]}';
const replacementJson = '{"segments":[{"text":"after"}]}';

function revision(json: string) {
  return `sha256:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}

function fixture(options: { initialJson?: string | null; apply?: boolean; itemCount?: number; readbackFailure?: boolean } = {}) {
  const state = { json: options.initialJson === undefined ? beforeJson : options.initialJson };
  const clip = { kind: "clip", getId: vi.fn(async () => "clip-1") };
  const filler = Array.from({ length: options.itemCount ?? 1 }, (_, index) => ({
    kind: "clip", getId: vi.fn(async () => index === (options.itemCount ?? 1) - 1 ? "clip-1" : `other-${index}`),
  }));
  const root = { kind: "folder", getItems: vi.fn(async () => filler) };
  if ((options.itemCount ?? 1) === 1) filler[0] = clip;
  const addAction = vi.fn((action: { apply?: () => void }) => {
    action.apply?.();
    return true;
  });
  const project = {
    guid: "project-1",
    getRootItem: vi.fn(async () => root),
    lockedAccess: vi.fn((work: () => void) => work()),
    executeTransaction: vi.fn((work: (compound: { addAction: typeof addAction }) => void) => {
      work({ addAction });
      return true;
    }),
  };
  let exportCalls = 0;
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    FolderItem: { cast: vi.fn((item: { kind?: string }) => item.kind === "folder" ? item : null) },
    ClipProjectItem: { cast: vi.fn((item: { kind?: string }) => item.kind === "clip" ? item : null) },
    Transcript: {
      hasTranscript: vi.fn(() => state.json !== null),
      exportToJSON: vi.fn(async () => {
        exportCalls += 1;
        if (options.readbackFailure && exportCalls > 2) throw new Error("post-commit export unavailable");
        if (state.json === null) throw new Error("no transcript");
        return state.json;
      }),
      importFromJSON: vi.fn((json: string) => ({ json })),
      createImportTextSegmentsAction: vi.fn((segments: { json: string }) => ({
        apply: () => { if (options.apply !== false) state.json = segments.json; },
      })),
    },
  };
  const runtime = TranscriptImport.createTranscriptImportRuntime({ ppro, TranscriptSupport: Transcript, Protocol });
  return { state, clip, project, ppro, runtime, addAction };
}

function args(overrides: Record<string, unknown> = {}) {
  return {
    projectItemId: "clip-1",
    expectedProjectGuid: "project-1",
    expectedTranscriptRevision: revision(beforeJson),
    json: replacementJson,
    confirmDestructive: true,
    operationId: "transcript-import-1",
    ...overrides,
  };
}

describe("guarded UXP transcript import", () => {
  it("matches Node's UTF-8 SHA-256 revision for non-ASCII transcript text", () => {
    const json = '{"segments":[{"text":"café 🎬"}]}';
    expect(Transcript.transcriptRevision(json)).toBe(revision(json));
    expect(Transcript.utf8ByteLength(json)).toBe(Buffer.byteLength(json, "utf8"));
    const unpairedSurrogate = "transcript-" + String.fromCharCode(0xd800);
    expect(Transcript.transcriptRevision(unpairedSurrogate)).toBe(revision(unpairedSurrogate));
    expect(Transcript.utf8ByteLength(unpairedSurrogate)).toBe(Buffer.byteLength(unpairedSurrogate, "utf8"));
  });

  it("imports one exact clip in one transaction and verifies exact export readback", async () => {
    const value = fixture();

    await expect(value.runtime.importTranscript(args())).resolves.toMatchObject({
      committed: true,
      verified: true,
      outcome: "verified",
      projectGuid: "project-1",
      projectItemId: "clip-1",
      requestedTranscriptRevision: revision(replacementJson),
      verificationBoundary: "transcript_export_exact_readback",
      operation: { verification: { status: "verified", boundary: "transcript_export_exact_readback" } },
    });
    expect(value.state.json).toBe(replacementJson);
    expect(value.project.lockedAccess).toHaveBeenCalledOnce();
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
    expect(value.addAction).toHaveBeenCalledOnce();
  });

  it("permits null only for an currently untranscribed exact clip", async () => {
    const value = fixture({ initialJson: null });

    await expect(value.runtime.importTranscript(args({ expectedTranscriptRevision: null }))).resolves.toMatchObject({
      committed: true, verified: true, requestedTranscriptRevision: revision(replacementJson),
    });
    expect(value.state.json).toBe(replacementJson);
  });

  it("rejects a stale preflight before creating an action", async () => {
    const value = fixture({ initialJson: replacementJson });

    await expect(value.runtime.importTranscript(args())).rejects.toMatchObject({ code: "UXP_STALE_TRANSCRIPT" });
    expect(value.project.executeTransaction).not.toHaveBeenCalled();
    expect(value.ppro.Transcript.createImportTextSegmentsAction).not.toHaveBeenCalled();
  });

  it("serializes distinct operation IDs so a stale concurrent import cannot overwrite the first", async () => {
    const value = fixture();
    const results = await Promise.allSettled([
      value.runtime.importTranscript(args({ operationId: "transcript-first" })),
      value.runtime.importTranscript(args({ operationId: "transcript-second", json: '{"segments":[{"text":"wrong"}]}' })),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "fulfilled", value: expect.objectContaining({ verified: true }) }),
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ code: "UXP_STALE_TRANSCRIPT" }) }),
    ]);
    expect(value.state.json).toBe(replacementJson);
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
  });

  it("returns committed_unverified when the committed import cannot be proven by readback", async () => {
    const value = fixture({ apply: false });

    await expect(value.runtime.importTranscript(args())).resolves.toMatchObject({
      committed: true,
      verified: false,
      outcome: "committed_unverified",
      verificationBoundary: "transcript_transaction_commit_with_readback_mismatch",
      operation: { verification: { status: "committed_unverified" } },
    });
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
  });

  it("does not turn a committed transaction into verified when post-commit export throws", async () => {
    const value = fixture({ readbackFailure: true });

    await expect(value.runtime.importTranscript(args())).resolves.toMatchObject({
      committed: true,
      verified: false,
      outcome: "committed_unverified",
      verificationBoundary: "transcript_transaction_commit_with_readback_unavailable",
      readbackError: "post-commit export unavailable",
      operation: { verification: { status: "committed_unverified" } },
    });
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
  });

  it("requires confirmation and rejects a project search beyond the bounded item limit", async () => {
    const confirmation = fixture();
    await expect(confirmation.runtime.importTranscript(args({ confirmDestructive: false }))).rejects.toMatchObject({ code: "UXP_CONFIRMATION_REQUIRED" });
    expect(confirmation.project.getRootItem).not.toHaveBeenCalled();

    const oversized = fixture({ itemCount: 513 });
    await expect(oversized.runtime.importTranscript(args())).rejects.toMatchObject({ code: "UXP_PROJECT_TOO_LARGE" });
    expect(oversized.project.executeTransaction).not.toHaveBeenCalled();
  });

  it("uses the command registry's operation-id replay without a second transaction", async () => {
    const value = fixture();
    const registry = Commands.createCommandRegistry({
      ppro: value.ppro,
      Protocol,
      transcriptImportHandler: value.runtime.importTranscript,
      transcriptImportProbe: value.runtime.canImportTranscript,
    });
    const input = args({ operationId: "transcript-replay" });

    const first = await registry.dispatch("transcript.import", input);
    const replay = await registry.dispatch("transcript.import", input);
    expect(first).toMatchObject({ verified: true, operationId: "transcript-replay" });
    expect(replay).toMatchObject({ verified: true, replayed: true, operationId: "transcript-replay" });
    expect(value.project.executeTransaction).toHaveBeenCalledOnce();
  });
});
