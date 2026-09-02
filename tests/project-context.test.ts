import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProjectContextDirectory,
  MAX_CONTEXT_RECORDS,
  normalizeContextKeywords,
  normalizeContextText,
  ProjectContextRepository,
  searchProjectContext,
} from "../src/context/project-context-store.js";
import {
  buildContextDocumentFromSnapshot,
  enrichContextDocument,
  getProjectContextTools,
  type PremiereContextSnapshot,
} from "../src/tools/project-context.js";

const temporaryDirectories: string[] = [];
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const supportsNodeSqlite = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function snapshot(overrides: Partial<PremiereContextSnapshot["sequence"]["clips"][number]> = {}): PremiereContextSnapshot {
  return {
    projectName: "Documentary",
    projectPath: "D:/Projects/documentary.prproj",
    sequence: {
      id: "sequence-1",
      name: "Assembly",
      durationSeconds: 120,
      truncated: false,
      clips: [
        {
          nodeId: "timeline-1",
          name: "Interview A",
          startSeconds: 10,
          endSeconds: 20,
          inPointSeconds: 30,
          outPointSeconds: 40,
          speed: 1,
          trackType: "video",
          trackIndex: 0,
          sourceId: "source-1",
          sourceName: "Interview A.mov",
          mediaPath: "D:/Media/interview-a.mov",
          offline: false,
          ...overrides,
        },
      ],
    },
  };
}

describe("project context index", () => {
  it("separates source invalidation from timeline placement revisions", async () => {
    let mediaVersion = 1;
    const fingerprint = async () => ({ mediaPathHash: "path-hash", size: 1_000, modifiedMs: mediaVersion });
    const first = await buildContextDocumentFromSnapshot(snapshot(), undefined, fingerprint);
    const source = first.document.records.find((record) => record.kind === "source")!;
    const enriched = enrichContextDocument(first.document, [
      {
        kind: "transcript",
        source_id: "source-1",
        source_revision: source.sourceRevision,
        start_seconds: 31,
        end_seconds: 35,
        text: "The budget needs approval by Friday.",
        keywords: ["budget", "approval"],
      },
    ]).document;

    const moved = await buildContextDocumentFromSnapshot(
      snapshot({ startSeconds: 45, endSeconds: 55 }),
      enriched,
      fingerprint,
    );
    expect(moved.document.sourceRevision).toBe(first.document.sourceRevision);
    expect(moved.document.timelineRevision).not.toBe(first.document.timelineRevision);
    expect(moved.document.records.some((record) => record.kind === "transcript")).toBe(true);
    expect(moved.invalidatedRecords).toBe(0);

    mediaVersion = 2;
    const changedSource = await buildContextDocumentFromSnapshot(snapshot(), moved.document, fingerprint);
    expect(changedSource.document.sourceRevision).not.toBe(first.document.sourceRevision);
    expect(changedSource.document.records.some((record) => record.kind === "transcript")).toBe(false);
    expect(changedSource.invalidatedRecords).toBe(1);
  });

  it("ranks bounded transcript and audio evidence while preserving revision provenance", async () => {
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({ mediaPathHash: "hash" }));
    const source = built.document.records.find((record) => record.kind === "source")!;
    const enriched = enrichContextDocument(built.document, [
      {
        id: "budget-transcript",
        kind: "transcript",
        name: "Budget answer",
        source_id: "source-1",
        source_revision: source.sourceRevision,
        start_seconds: 31,
        end_seconds: 35,
        text: "The budget needs approval by Friday.",
        keywords: ["budget", "approval"],
      },
      {
        id: "room-tone",
        kind: "audio",
        source_id: "source-1",
        source_revision: source.sourceRevision,
        text: "Quiet room tone suitable for dialogue padding.",
        keywords: ["room tone"],
      },
    ]).document;

    const results = searchProjectContext(enriched, { query: "budget approval", limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].record.id).toBe("budget-transcript");
    expect(results[0].record.sourceRevision).toBe(source.sourceRevision);
    expect(results[0].matchedTerms).toEqual(expect.arrayContaining(["budget", "approval"]));
  });

  it("persists locally without retaining a native media path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ppmcp-context-test-"));
    temporaryDirectories.push(directory);
    const repository = new ProjectContextRepository({ backend: "json", directory });
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({ mediaPathHash: "redacted-path-hash" }));
    await repository.put(built.document);

    const restored = await repository.get(built.document.projectId);
    expect(restored).toEqual(built.document);
    expect(await repository.backendName()).toBe("json");
    const files = await readdir(directory);
    const serialized = await readFile(path.join(directory, files.find((name) => name.endsWith(".json"))!), "utf8");
    expect(serialized).not.toContain("D:/Media/interview-a.mov");
    expect(serialized).toContain("redacted-path-hash");
  });

  it.runIf(supportsNodeSqlite)("uses SQLite when requested and supports complete repository lifecycle", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ppmcp-context-sqlite-test-"));
    temporaryDirectories.push(directory);
    const repository = new ProjectContextRepository({ backend: "sqlite", directory });
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({ mediaPathHash: "hash" }));

    expect(await repository.backendName()).toBe("sqlite");
    expect(await repository.get("missing")).toBeUndefined();
    await repository.put(built.document);
    expect(await repository.get(built.document.projectId)).toEqual(built.document);
    expect(await repository.list()).toEqual([
      expect.objectContaining({ projectId: built.document.projectId, recordCount: built.document.records.length }),
    ]);
    const updated = { ...built.document, projectName: "Updated documentary" };
    await repository.put(updated);
    expect((await repository.get(built.document.projectId))?.projectName).toBe("Updated documentary");
    expect(await repository.delete(built.document.projectId)).toBe(true);
    expect(await repository.delete(built.document.projectId)).toBe(false);
    await repository.close();
  });

  it("handles missing and corrupt JSON entries without hiding valid project summaries", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ppmcp-context-json-test-"));
    temporaryDirectories.push(directory);
    const repository = new ProjectContextRepository({ backend: "json", directory });
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({}));

    expect(await repository.get("missing")).toBeUndefined();
    expect(await repository.delete("missing")).toBe(false);
    await repository.put(built.document);
    await writeFile(path.join(directory, "corrupt.json"), "not json", "utf8");
    expect(await repository.list()).toEqual([
      expect.objectContaining({ projectId: built.document.projectId }),
    ]);

    const validFile = (await readdir(directory)).find((name) => name !== "corrupt.json")!;
    await writeFile(path.join(directory, validFile), JSON.stringify({ schemaVersion: 999 }), "utf8");
    await expect(repository.get(built.document.projectId)).rejects.toThrow("Unsupported project context schema version");
  });

  it("validates repository backend, record bounds, and context directory overrides", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ppmcp-context-env-test-"));
    temporaryDirectories.push(directory);
    vi.stubEnv("PREMIERE_CONTEXT_DIR", directory);
    expect(defaultProjectContextDirectory()).toBe(path.resolve(directory));
    await expect(new ProjectContextRepository({ backend: "invalid" as any }).backendName())
      .rejects.toThrow("must be auto, sqlite, json, or memory");

    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({}));
    const repository = new ProjectContextRepository({ backend: "memory" });
    await expect(repository.put({
      ...built.document,
      records: Array.from({ length: MAX_CONTEXT_RECORDS + 1 }, () => built.document.records[0]),
    })).rejects.toThrow(`limited to ${MAX_CONTEXT_RECORDS}`);
    expect(await repository.get("missing")).toBeUndefined();
    expect(await repository.list()).toEqual([]);
    expect(await repository.delete("missing")).toBe(false);
  });

  it("normalizes bounded text and filters search by sequence, kind, and result limits", async () => {
    expect(normalizeContextText(null)).toBe("");
    expect(normalizeContextText("  multiple\n spaces ")).toBe("multiple spaces");
    expect(normalizeContextKeywords("not-an-array")).toEqual([]);
    expect(normalizeContextKeywords([" budget ", "budget", 4])).toEqual(["budget"]);
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({}));
    expect(() => searchProjectContext(built.document, { query: "   " })).toThrow("must not be empty");
    expect(searchProjectContext(built.document, {
      query: "interview",
      sequenceId: "different-sequence",
    })).toEqual([]);
    const sourceOnly = searchProjectContext(built.document, {
      query: "interview",
      kinds: ["source"],
      limit: 100,
    });
    expect(sourceOnly).toHaveLength(1);
    expect(sourceOnly[0].record.kind).toBe("source");
    expect(searchProjectContext(built.document, { query: "not-present", limit: -4 })).toEqual([]);
  });

  it("supports enrich, status, search, plan, and clear through the MCP tool contracts", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({ mediaPathHash: "hash" }));
    await repository.put(built.document);
    const tools = getProjectContextTools({}, { repository });
    const source = built.document.records.find((record) => record.kind === "source")!;

    const enrich = await (tools.manage_project_context.handler as any)({
      action: "enrich",
      project_id: built.document.projectId,
      records: [
        {
          kind: "transcript",
          source_id: "source-1",
          source_revision: source.sourceRevision,
          start_seconds: 31,
          end_seconds: 35,
          text: "The budget needs approval by Friday.",
          keywords: ["budget"],
          metadata: { confidence: 0.97, source_path: "D:/private.mov", api_token: "secret" },
        },
      ],
    });
    expect(enrich).toMatchObject({ success: true, data: { upserted: 1 } });

    const status = await (tools.manage_project_context.handler as any)({
      action: "status",
      project_id: built.document.projectId,
    });
    expect(status).toMatchObject({ success: true, data: { backend: "memory", counts: { transcript: 1 } } });

    const search = await (tools.search_project_context.handler as any)({
      project_id: built.document.projectId,
      query: "budget",
    });
    expect(search.data.results[0]).toMatchObject({ kind: "transcript", sourceId: "source-1" });
    expect(search.data.results[0].metadata).toEqual({ confidence: 0.97 });
    await expect((tools.search_project_context.handler as any)({
      project_id: built.document.projectId,
      query: "budget",
      max_results: 51,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("1 through 50") });

    const plan = await (tools.create_context_edit_plan.handler as any)({
      project_id: built.document.projectId,
      intent: "Use the budget answer",
    });
    expect(plan).toMatchObject({
      success: true,
      data: {
        applied: false,
        expectedTimelineRevision: built.document.timelineRevision,
        candidates: [{ kind: "transcript", sourceId: "source-1" }],
      },
    });
    expect(plan.data.nextSteps.join(" ")).toContain("preview_edit_plan");

    const cleared = await (tools.manage_project_context.handler as any)({
      action: "clear",
      project_id: built.document.projectId,
    });
    expect(cleared).toEqual({ success: true, data: { projectId: built.document.projectId, cleared: true } });
  });

  it("captures through the MCP contract and preserves bridge failures", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const captureSnapshot = vi.fn().mockResolvedValue({ success: true, data: snapshot() });
    const tools = getProjectContextTools({}, { repository, captureSnapshot });
    const captured = await (tools.manage_project_context.handler as any)({ action: "capture" });
    expect(captured).toMatchObject({
      success: true,
      data: { backend: "memory", projectName: "Documentary", recordCount: 4, invalidatedRecords: 0 },
    });
    expect(captureSnapshot).toHaveBeenCalledOnce();

    const statusList = await (tools.manage_project_context.handler as any)({ action: "status" });
    expect(statusList.data.projects).toHaveLength(1);
    const failedTools = getProjectContextTools({}, {
      repository,
      captureSnapshot: async () => ({ success: false, error: "Premiere offline" }),
    });
    await expect((failedTools.manage_project_context.handler as any)({ action: "capture" }))
      .resolves.toEqual({ success: false, error: "Premiere offline" });
  });

  it("returns bounded not-found and unsupported-action errors", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const tools = getProjectContextTools({}, { repository });
    await expect((tools.manage_project_context.handler as any)({ action: "status", project_id: "missing" }))
      .resolves.toEqual({ success: false, error: "Project context not found" });
    await expect((tools.manage_project_context.handler as any)({ action: "enrich", project_id: "missing", records: [] }))
      .resolves.toEqual({ success: false, error: "Project context not found; capture it before enrichment" });
    await expect((tools.search_project_context.handler as any)({ project_id: "missing", query: "x" }))
      .resolves.toEqual({ success: false, error: "Project context not found" });
    await expect((tools.create_context_edit_plan.handler as any)({ project_id: "missing", intent: "x" }))
      .resolves.toEqual({ success: false, error: "Project context not found" });
    await expect((tools.manage_project_context.handler as any)({ action: "unknown" }))
      .resolves.toEqual({ success: false, error: "Unsupported project context action: unknown" });
    await expect((tools.manage_project_context.handler as any)({ action: "clear", project_id: "" }))
      .rejects.toThrow("project_id is required");
  });

  it("rejects stale enrichment revisions", async () => {
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({ mediaPathHash: "hash" }));
    expect(() => enrichContextDocument(built.document, [
      {
        kind: "transcript",
        source_id: "source-1",
        source_revision: "stale",
        text: "Old analysis",
      },
    ])).toThrow("stale source_revision");
  });

  it("validates enrichment shapes, bounds, replacement, and timeline revisions", async () => {
    const built = await buildContextDocumentFromSnapshot(snapshot(), undefined, async () => ({}));
    expect(() => enrichContextDocument(built.document, [])).toThrow("at least one enrichment");
    expect(() => enrichContextDocument(built.document, Array.from({ length: 513 }, () => ({
      kind: "note" as const,
      text: "note",
    })))).toThrow("limited to 512");
    expect(() => enrichContextDocument(built.document, [{ kind: "source", text: "bad" }]))
      .toThrow("kind must be transcript, shot, audio, or note");
    expect(() => enrichContextDocument(built.document, [{ kind: "note", text: "  " }]))
      .toThrow("text must not be empty");
    expect(() => enrichContextDocument(built.document, [{ kind: "audio", source_id: "missing", text: "quiet" }]))
      .toThrow("unknown source_id");
    expect(() => enrichContextDocument(built.document, [{
      kind: "note",
      timeline_revision: "stale",
      text: "stale note",
    }])).toThrow("stale timeline_revision");
    expect(() => enrichContextDocument(built.document, [{ kind: "shot", start_seconds: -1, text: "bad" }]))
      .toThrow("start_seconds must be non-negative");
    expect(() => enrichContextDocument(built.document, [{ kind: "shot", start_seconds: 5, end_seconds: 4, text: "bad" }]))
      .toThrow("end_seconds must be at or after");

    const first = enrichContextDocument(built.document, [{ id: "replace-me", kind: "note", text: "first" }]).document;
    const replaced = enrichContextDocument(first, [{
      id: "replace-me",
      kind: "note",
      text: "second",
      timeline_item_id: "timeline-1",
      timeline_revision: first.timelineRevision,
      track_type: "video",
      track_index: 0,
      metadata: { approved: true, score: 1, nullable: null, nested: { ignored: true } },
    }], true).document;
    expect(replaced.records.filter((record) => record.kind === "note")).toEqual([
      expect.objectContaining({ text: "second", timelineRevision: first.timelineRevision }),
    ]);
  });

  it("validates incomplete and oversized Premiere snapshots", async () => {
    await expect(buildContextDocumentFromSnapshot({ projectName: "bad" } as any))
      .rejects.toThrow("incomplete context snapshot");
    const oversized = snapshot();
    oversized.sequence.clips = Array.from({ length: 2_001 }, (_, index) => ({
      ...snapshot().sequence.clips[0],
      nodeId: `clip-${index}`,
    }));
    await expect(buildContextDocumentFromSnapshot(oversized))
      .rejects.toThrow("limited to 2000 timeline items");
  });
});
