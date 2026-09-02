import { describe, expect, it } from "vitest";
import {
  buildEditorialContextPack,
  MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS,
  MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
} from "../src/ai/editorial-context-pack.js";
import {
  ProjectContextRepository,
  searchProjectContext,
  type ProjectContextDocument,
} from "../src/context/project-context-store.js";
import { getEditorialContextPackTools } from "../src/tools/editorial-context-pack.js";
import { createServer } from "../src/server.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

function document(): ProjectContextDocument {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    projectName: "Launch interview",
    revision: "context-r1",
    sourceRevision: "source-r1",
    timelineRevision: "timeline-r1",
    updatedAt: "2026-09-02T00:00:00.000Z",
    records: [
      {
        id: "source-1",
        kind: "source",
        name: "Founder interview",
        text: "Source Founder interview. Media type mov.",
        keywords: ["interview", "mov"],
        sourceId: "source-item-1",
        sourceRevision: "source-r1",
        indexedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "transcript-1",
        kind: "transcript",
        name: "Founder on the launch budget",
        text: "We made the launch budget work by simplifying the onboarding flow.",
        keywords: ["launch", "budget", "onboarding"],
        sequenceId: "sequence-1",
        sourceId: "source-item-1",
        startSeconds: 12.5,
        endSeconds: 17.25,
        sourceRevision: "source-r1",
        timelineRevision: "timeline-r1",
        metadata: { secret: "must-not-appear" },
        indexedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        id: "shot-1",
        kind: "shot",
        name: "Product close-up",
        text: "Product close-up during the onboarding explanation.",
        keywords: ["product", "onboarding"],
        sequenceId: "sequence-1",
        sourceId: "source-item-2",
        startSeconds: 30,
        endSeconds: 35,
        sourceRevision: "source-r1",
        indexedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
  };
}

describe("editorial context pack", () => {
  it("renders stable, compact evidence without leaking metadata", () => {
    const source = document();
    const results = searchProjectContext(source, { query: "launch budget onboarding", limit: 12 });
    const first = buildEditorialContextPack(source, { intent: "launch budget onboarding", results });
    const second = buildEditorialContextPack(source, { intent: "launch budget onboarding", results });

    expect(first).toMatchObject({
      schemaVersion: 1,
      projectId: "project-1",
      expectedContextRevision: "context-r1",
      expectedSourceRevision: "source-r1",
      expectedTimelineRevision: "timeline-r1",
      applied: false,
      truncated: false,
    });
    expect(first.markdown).toContain("# Premiere editorial context pack");
    expect(first.markdown).toContain("evidence transcript-1");
    expect(first.markdown).toContain("12.500s–17.250s");
    expect(first.markdown).toContain("We made the launch budget work");
    expect(first.markdown).not.toContain("must-not-appear");
    expect(first.evidence[0]).toMatchObject({
      evidenceId: "transcript-1",
      kind: "transcript",
      sourceId: "source-item-1",
      startSeconds: 12.5,
      endSeconds: 17.25,
      textTruncated: false,
    });
    expect(first).toEqual(second);
  });

  it("enforces a strict Markdown cap and labels partial evidence", () => {
    const source = document();
    source.records[1].text = `Budget evidence ${"with supporting detail ".repeat(3_000)}`;
    const results = searchProjectContext(source, { query: "budget", limit: 12 });
    const pack = buildEditorialContextPack(source, {
      intent: "budget",
      results,
      maxCharacters: MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
    });

    expect(pack.markdown.length).toBeLessThanOrEqual(MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS);
    expect(pack.truncated).toBe(true);
    expect(pack.evidence[0]).toMatchObject({ evidenceId: "transcript-1", textTruncated: true });
    expect(pack.markdown).toContain("[excerpt truncated]");
  });

  it("preserves the Markdown cap when project labels and revisions are long", () => {
    const source = document();
    source.projectName = "Project ".repeat(80);
    source.revision = "context-".repeat(100);
    source.sourceRevision = "source-".repeat(100);
    source.timelineRevision = "timeline-".repeat(100);
    const intent = `budget ${"review ".repeat(140)}`;
    const results = searchProjectContext(source, { query: "budget", limit: 12 });
    const pack = buildEditorialContextPack(source, {
      intent,
      results,
      maxCharacters: MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS,
    });

    expect(pack.intent).toBe(intent.trim());
    expect(pack.markdown.length).toBeLessThanOrEqual(MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS);
  });

  it("validates pack bounds before producing output", () => {
    const source = document();
    const results = searchProjectContext(source, { query: "budget" });
    expect(() => buildEditorialContextPack(source, { intent: " ", results })).toThrow("intent must not be empty");
    expect(() => buildEditorialContextPack(source, { intent: "budget", results, maxEntries: 0 })).toThrow("max_entries");
    expect(() => buildEditorialContextPack(source, { intent: "budget", results, maxCharacters: MIN_EDITORIAL_CONTEXT_PACK_CHARACTERS - 1 })).toThrow("max_characters");
    expect(() => buildEditorialContextPack(source, { intent: "budget", results, maxCharacters: MAX_EDITORIAL_CONTEXT_PACK_CHARACTERS + 1 })).toThrow("max_characters");
  });

  it("reads only stored local context and rejects invalid tool input", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const tools = getEditorialContextPackTools({ repository });
    await repository.put(document());

    await expect(tools.create_editorial_context_pack.handler({
      project_id: "project-1",
      intent: "launch budget",
      kinds: ["transcript"],
      max_entries: 4,
      max_characters: 2_000,
    })).resolves.toMatchObject({
      success: true,
      data: {
        applied: false,
        evidence: [expect.objectContaining({ kind: "transcript" })],
      },
    });
    await expect(tools.create_editorial_context_pack.handler({
      project_id: "missing",
      intent: "launch budget",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
    await expect(tools.create_editorial_context_pack.handler({
      project_id: "project-1",
      intent: "launch budget",
      kinds: ["transcript", "transcript"],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("duplicates") });
    await expect(tools.create_editorial_context_pack.handler({
      project_id: "project-1",
      intent: "launch budget",
      max_characters: 1,
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("max_characters") });
    await expect(tools.create_editorial_context_pack.handler({
      project_id: "p".repeat(513),
      intent: "launch budget",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("at most 512") });
  });

  it("reports entry overflow and excludes records with no matched intent term", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    const source = document();
    for (let index = 2; index <= 100; index++) {
      source.records.push({
        ...source.records[1], id: `transcript-${index}`, name: `Budget answer ${index}`,
        text: `The launch budget answer ${index}.`,
      });
    }
    await repository.put(source);
    const tool = getEditorialContextPackTools({ repository }).create_editorial_context_pack;

    await expect(tool.handler({ project_id: "project-1", intent: "budget", max_entries: 12 }))
      .resolves.toMatchObject({
        success: true,
        data: { evidence: expect.any(Array), omittedEvidenceCount: 88, truncated: true },
      });
    await expect(tool.handler({ project_id: "project-1", intent: "unrelated", kinds: ["transcript"] }))
      .resolves.toMatchObject({ success: true, data: { evidence: [], omittedEvidenceCount: 0, truncated: false } });
  });

  it("shares the injected server context repository with the reading tool", async () => {
    const repository = new ProjectContextRepository({ backend: "memory" });
    await repository.put(document());
    const server = createServer({}, { contextRepository: repository });
    const client = new Client({ name: "editorial-context-pack-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: "create_editorial_context_pack",
        arguments: { project_id: "project-1", intent: "launch budget" },
      });
      expect((result.structuredContent as any).data).toMatchObject({ projectId: "project-1", applied: false });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
