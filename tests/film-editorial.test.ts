import { describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildFilmEditorialPacket, type FilmEditorialInput } from "../src/ai/film-editorial.js";
import { ProjectContextRepository, type ProjectContextDocument } from "../src/context/project-context-store.js";
import { getFilmEditorialTools } from "../src/tools/film-editorial.js";
import { createServer } from "../src/server.js";
import { buildContextDocumentFromSnapshot } from "../src/tools/project-context.js";
import example from "../docs/film-editorial-workflows.example.json";

function fixture() {
  const document: ProjectContextDocument = {
    schemaVersion: 1, projectId: "p", projectName: "Film", revision: "c1", sourceRevision: "s1", timelineRevision: "t1", updatedAt: "2026-09-08T00:00:00Z",
    records: [
      { id: "source-e", kind: "source", name: "Slate 1", text: "", keywords: [], sourceId: "source", sourceRevision: "s1", indexedAt: "2026-09-08T00:00:00Z", metadata: { privatePath: "never expose" } },
      { id: "timeline-e", kind: "timeline", name: "Take 1", text: "", keywords: [], sourceId: "source", timelineItemId: "occ", sequenceId: "seq", timelineRevision: "t1", indexedAt: "2026-09-08T00:00:00Z" },
    ],
  };
  const input: FilmEditorialInput = {
    project_id: "p", expected_context_revision: "c1", expected_source_revision: "s1", expected_timeline_revision: "t1", script_revision: "script1",
    profile: { name: "Dialogue", reviewMode: "beat_sections", overlapFrames: 12, trackRoles: [{ name: "Picture", type: "video", index: 0 }] },
    scenes: [{ id: "scene1", label: "Kitchen" }, { id: "scene2", label: "Memory" }],
    sources: [{ evidenceId: "source-e", sourceId: "source", sourceRevision: "s1", durationFrames: 240, timebase: { numerator: 24000, denominator: 1001 }, sync: "checked", channels: ["Boom", "Lav"] }],
    coverage: [
      { id: "cov1", sourceId: "source", sceneIds: ["scene1", "scene2"], range: { inFrame: 10, outFrame: 110 }, setup: "wide", take: "1", lineId: "line1", beatId: "beat1", picture: { reviewer: "editor", revision: "script1", rank: 1, reason: "Performance" } },
      { id: "cov2", sourceId: "source", sceneIds: ["scene1"], range: { inFrame: 120, outFrame: 230 }, setup: "wide", take: "2", lineId: "line1", beatId: "beat1", audio: { reviewer: "AE", revision: "script1", rank: 1, reason: "Clean dialogue" } },
    ],
    occurrences: [{ id: "occ", evidenceId: "timeline-e", timelineRevision: "t1", sourceId: "source", coverageId: "cov1", sequenceId: "seq", reelId: "reel1", sourceRange: { inFrame: 10, outFrame: 110 }, timelineRange: { inFrame: 0, outFrame: 100 }, timebase: { numerator: 24000, denominator: 1001 }, speed: "1x" }],
    notes: [{ id: "note1", sequenceId: "seq", timelineRevision: "t0", frame: 80, text: "Hold reaction", status: "open", reviewer: "director" }],
    vfx: [{ shotId: "shot1", occurrenceId: "occ", version: "v2", previousVersion: "v1", creativeStatus: "candidate", deliveryStatus: "acknowledged", receipt: "receipt1" }],
    storyCards: [{ id: "card1", title: "Kitchen memory", coverageIds: ["cov1"], dependsOn: [] }],
    turnover: { department: "sound", handlesFrames: 24, format: "AAF", settings: "48kHz separate audio; verify host export settings" },
    viewing: { purpose: "screening", burnIns: false, roughVfx: true, tempAudio: true },
  };
  return { document, input };
}

describe("film editorial packets", () => {
  it("accepts the documented example", () => {
    expect(buildFilmEditorialPacket(fixture().document, example)).toMatchObject({ applied: false, reviewArtifacts: { kind: "line_comparison" } });
  });

  it("works with real context capture's distinct item and aggregate revisions", async () => {
    const captured = await buildContextDocumentFromSnapshot({
      projectName: "Synthetic film", projectPath: "synthetic.prproj",
      sequence: { id: "seq", name: "Assembly", durationSeconds: 10, truncated: true,
        clips: [{ nodeId: "occ", name: "Take", startSeconds: 0, endSeconds: 100 * 1001 / 24000,
          inPointSeconds: 10 * 1001 / 24000, outPointSeconds: 110 * 1001 / 24000,
          speed: 1, trackType: "video", trackIndex: 0, sourceId: "source", sourceName: "Take", offline: true }] },
    });
    const { input } = fixture();
    const doc = captured.document;
    input.project_id = doc.projectId;
    input.expected_context_revision = doc.revision;
    input.expected_source_revision = doc.sourceRevision;
    input.expected_timeline_revision = doc.timelineRevision;
    const source = doc.records.find(r => r.kind === "source")!;
    const occurrence = doc.records.find(r => r.kind === "timeline")!;
    input.sources[0].sourceRevision = source.sourceRevision!;
    input.sources[0].evidenceId = source.id;
    input.occurrences[0].evidenceId = occurrence.id;
    input.occurrences[0].timelineRevision = occurrence.timelineRevision!;
    expect(source.sourceRevision).not.toBe(doc.sourceRevision);
    expect(occurrence.timelineRevision).not.toBe(doc.timelineRevision);
    expect(buildFilmEditorialPacket(doc, input).exceptions.map(e => e.code)).toEqual(expect.arrayContaining(["source_offline", "capture_truncated"]));
    input.occurrences[0].timelineRange.inFrame = 1;
    expect(() => buildFilmEditorialPacket(doc, input)).toThrow(/Captured timeline timing mismatch/);
  });
  it("preserves many-to-many coverage and independent preferences, with bounded review overlap", () => {
    const { document, input } = fixture();
    const result = buildFilmEditorialPacket(document, input);
    expect(result.sceneCoverage.map(s => s.coverageIds)).toEqual([["cov1", "cov2"], ["cov1"]]);
    expect(result.sceneCoverage[0].picturePreferences[0].coverageId).toBe("cov1");
    expect(result.sceneCoverage[0].audioPreferences[0].coverageId).toBe("cov2");
    expect(result.reviewGroups[0].items.map(i => i.reviewRange)).toEqual([{ inFrame: 0, outFrame: 122 }, { inFrame: 108, outFrame: 240 }]);
    expect(result.coverageGraph[0].range).toEqual({ inFrame: 10, outFrame: 110 });
    expect(result.vfx[0]).toMatchObject({ creativeStatus: "candidate", deliveryStatus: "acknowledged", replacementAuthorized: false, previousVersion: "v1" });
    expect(JSON.stringify(result)).not.toContain("never expose");
    expect(result).toMatchObject({ applied: false, hostVerified: false, turnover: { exported: false } });
    expect(buildFilmEditorialPacket(document, input)).toEqual(result);
  });

  it.each(["source_markers", "full_stringout", "line_comparison"] as const)("does not add beat handles to %s", mode => {
    const { document, input } = fixture();
    input.profile.reviewMode = mode;
    const result = buildFilmEditorialPacket(document, input);
    expect(result.reviewGroups[0].items[0].reviewRange).toEqual(input.coverage[0].range);
  });

  it("preserves stale note frames and reports short handles without declaring turnover ready", () => {
    const { document, input } = fixture();
    const result = buildFilmEditorialPacket(document, input);
    expect(result.notes[0]).toMatchObject({ frame: 80, timelineRevision: "t0", resolution: "revision_unresolved", remapped: false });
    expect(result.turnover.entries[0]).toMatchObject({ availableHead: 10, availableTail: 24, exportSourceRange: { inFrame: 0, outFrame: 134 } });
    expect(result.turnover.readyForHostPreflight).toBe(false);
    expect(result.exceptions.map(e => e.code)).toContain("handles_short");
  });

  it("reports missing coverage, unresolved sync, missing channels and omitted captured sources", () => {
    const { document, input } = fixture();
    document.records.push({ ...document.records[0], id: "source-other", sourceId: "other" });
    input.scenes.push({ id: "absent", label: "Missing" });
    input.sources[0].sync = "unknown";
    input.sources[0].channels = [];
    expect(buildFilmEditorialPacket(document, input).exceptions.map(e => e.code)).toEqual(expect.arrayContaining(["source_not_in_inventory", "scene_uncovered", "sync_unresolved", "channels_missing"]));
  });

  it.each([
    ["stale context", (i: FilmEditorialInput) => { i.expected_context_revision = "old"; }],
    ["stale source", (i: FilmEditorialInput) => { i.sources[0].sourceRevision = "old"; }],
    ["wrong source", (i: FilmEditorialInput) => { i.sources[0].evidenceId = "timeline-e"; }],
    ["duplicate coverage", (i: FilmEditorialInput) => { i.coverage.push(i.coverage[0]); }],
    ["wrong occurrence", (i: FilmEditorialInput) => { i.occurrences[0].id = "other"; }],
    ["reversed range", (i: FilmEditorialInput) => { i.coverage[0].range.outFrame = 0; }],
    ["out of source", (i: FilmEditorialInput) => { i.coverage[0].range.outFrame = 241; }],
    ["outside coverage", (i: FilmEditorialInput) => { i.occurrences[0].sourceRange.inFrame = 0; }],
    ["wrong timebase", (i: FilmEditorialInput) => { i.occurrences[0].timebase.numerator = 24; }],
    ["missing line", (i: FilmEditorialInput) => { i.profile.reviewMode = "line_comparison"; delete i.coverage[0].lineId; }],
    ["cycle", (i: FilmEditorialInput) => { i.storyCards[0].dependsOn = ["card1"]; }],
    ["unknown dependency", (i: FilmEditorialInput) => { i.storyCards[0].dependsOn = ["missing"]; }],
    ["missing receipt", (i: FilmEditorialInput) => { delete i.vfx[0].receipt; }],
    ["fractional frames", (i: FilmEditorialInput) => { i.coverage[0].range.inFrame = 1.5; }],
  ] as const)("rejects %s", (_label, mutate) => {
    const { document, input } = fixture();
    mutate(input);
    expect(() => buildFilmEditorialPacket(document, input)).toThrow();
  });

  it("uses exact rational arithmetic for equivalent rates and requires review for retimes", () => {
    const { document, input } = fixture();
    input.occurrences[0].timebase = { numerator: 48000, denominator: 2002 };
    expect(() => buildFilmEditorialPacket(document, input)).not.toThrow();
    input.occurrences[0].speed = "retimed";
    input.occurrences[0].timelineRange.outFrame = 90;
    expect(buildFilmEditorialPacket(document, input).exceptions.map(e => e.code)).toContain("retime_manual_review");
  });

  it("diffs reel and removed occurrence changes and rejects conflicting same-revision snapshots", () => {
    const { document, input } = fixture();
    input.previous = buildFilmEditorialPacket(document, input).snapshot;
    input.occurrences[0].reelId = "reel2";
    expect(() => buildFilmEditorialPacket(document, input)).toThrow(/share a timeline revision/);
    input.previous.timelineRevision = "t0";
    input.previous.occurrences.push({ ...input.previous.occurrences[0], id: "removed" });
    const result = buildFilmEditorialPacket(document, input);
    expect(result.changeImpact.changes).toEqual([
      { id: "occ", change: "reel_changed", departments: ["sound", "color", "vfx"] },
      { id: "removed", change: "removed", departments: ["sound", "color", "vfx"] },
    ]);
  });

  it("detects changed source media while the aggregate timeline revision stays unchanged", () => {
    const { document, input } = fixture();
    input.previous = buildFilmEditorialPacket(document, input).snapshot;
    document.sourceRevision = "sources2";
    input.expected_source_revision = "sources2";
    document.records[0].sourceRevision = "source2";
    input.sources[0].sourceRevision = "source2";
    expect(buildFilmEditorialPacket(document, input).changeImpact.changes).toEqual([{ id: "occ", change: "changed", departments: ["sound", "color", "vfx"] }]);
  });

  it("rejects missing context and unknown input fields through the direct handler", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const { document, input } = fixture();
    const tool = getFilmEditorialTools({ repository }).inspect_film_editorial_workflow;
    expect(await tool.handler(input)).toMatchObject({ success: false, error: expect.stringContaining("not found") });
    await repository.put(document);
    expect(await tool.handler({ ...input, apply: true })).toMatchObject({ success: false });
    expect(await tool.handler(input)).toMatchObject({ success: true, data: { applied: false } });
  });

  it("registers a callable read-only MCP tool backed by the server context repository", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const { document, input } = fixture();
    await repository.put(document);
    const server = createServer({}, { contextRepository: repository });
    const client = new Client({ name: "film-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const listing = await client.listTools();
      expect(listing.tools.find(t => t.name === "inspect_film_editorial_workflow")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const response = await client.callTool({ name: "inspect_film_editorial_workflow", arguments: input });
      expect(response.structuredContent).toMatchObject({ ok: true, data: { projectId: "p", hostVerified: false } });
      const stale = await client.callTool({ name: "inspect_film_editorial_workflow", arguments: { ...input, expected_timeline_revision: "old" } });
      expect(stale.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
