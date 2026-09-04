import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const api = require("../../uxp-plugin/dialogue-workflows.cjs");

describe("UXP dialogue command module", () => {
  it("registers a guarded non-undoable ordinary-sequence command", () => {
    const definitions = api.createDialogueWorkflowDefinitions({ ppro: {} });
    expect(definitions["dialogue.deriveSequence"]).toMatchObject({ destructive: true, undoable: false, idempotent: true, minHostVersion: "26.3.0" });
    expect(definitions["dialogue.deriveSequence"].probe()).toBe(false);
  });
  it("creates linked subclips and an ordinary sequence with structural-only proof", async () => {
    const children: any[] = [];
    const parent = { name: "Media", getId: async () => "bin", getItems: async () => children };
    const source = { name: "Source", getId: async () => "clip", getParentBin: async () => parent, isMulticamClip: async () => false,
      createSubClipAction: (name: string) => ({ apply: () => children.push({ name, getId: async () => `sub-${children.length + 1}` }) }) };
    const root = { getId: async () => "root", getItems: async () => [source] };
    const createdSequences: any[] = [];
    const project = { getGuid: async () => "project", getRootItem: async () => root, getSequences: async () => createdSequences,
      lockedAccess: (fn: () => void) => fn(), executeTransaction: (fn: (compound: any) => void) => { fn({ addAction: (action: any) => { action.apply(); return true; } }); return true; },
      createSequenceFromMedia: async (name: string) => { const sequence = { name, getGuid: async () => "sequence" }; createdSequences.push(sequence); return sequence; } };
    const ppro = { Project: { getActiveProject: async () => project }, ClipProjectItem: { cast: (item: any) => item.createSubClipAction ? item : null }, FolderItem: { cast: (item: any) => item.getItems ? item : null },
      TickTime: { createWithSeconds: (seconds: number) => ({ seconds }) }, SequenceEditor: { getEditor: () => ({ createInsertProjectItemAction: () => ({ apply() {} }) }) } };
    const command = api.createDialogueWorkflowDefinitions({ ppro })["dialogue.deriveSequence"];
    const result = await command.handler({ operationId: "op-1", plan: { schema_version: 1, project_guid: "project", mode: "talking_head", sequence_name: "Reviewed", segments: [
      { id: "one", source_project_item_id: "clip", transcript_revision: `sha256:${"a".repeat(64)}`, source_start_seconds: 0, source_end_seconds: 1 },
      { id: "two", source_project_item_id: "clip", transcript_revision: `sha256:${"a".repeat(64)}`, source_start_seconds: 2, source_end_seconds: 3 },
    ], output_duration_seconds: 2, original_sources_unchanged: true, render_verified: false } });
    expect(result).toMatchObject({ outcome: "committed_unverified", partial: false, originalSourcesChanged: false, renderVerified: false });
    expect(result.createdSubclips).toHaveLength(2);
    expect(result.insertedProjectItemIds).toHaveLength(2);
  });
});
