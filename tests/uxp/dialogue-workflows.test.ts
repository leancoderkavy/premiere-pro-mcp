import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const api = require("../../uxp-plugin/dialogue-workflows.cjs");

describe("UXP dialogue command module", () => {
  it("registers a guarded non-undoable ordinary-sequence command", () => {
    const definitions = api.createDialogueWorkflowDefinitions({ ppro: {} });
    expect(definitions["dialogue.deriveSequence"]).toMatchObject({ destructive: true, undoable: false, idempotent: true, minHostVersion: "26.3.0" });
    expect(definitions["dialogue.deriveSequence"].probe()).toBe(false);
  });
  it.each(["method", "guid_string", "guid_object", "empty_methods", "invalid_methods"])("creates linked subclips with %s project identity and structural-only proof", async (identity) => {
    const children: any[] = [];
    const parent = { name: "Media", getId: async () => "bin", getItems: async () => children };
    const source = { name: "Source", getId: async () => "clip", getParentBin: async () => parent, isMulticamClip: async () => false,
      createSubClipAction: (name: string) => ({ apply: () => children.push({ name, getId: async () => `sub-${children.length + 1}` }) }) };
    const root = { getId: async () => "root", getItems: async () => [source] };
    const createdSequences: any[] = [];
    const project = { ...(identity === "method" ? { getGuid: async () => "project" } : { guid: identity === "guid_object" ? { toString: () => "project" } : "project" }),
      ...(identity === "empty_methods" ? { getId: async () => null, getGuid: async () => undefined } : {}), getRootItem: async () => root, getSequences: async () => createdSequences,
      ...(identity === "invalid_methods" ? { getId: async () => ({}), getGuid: async () => ({ toString: () => null }) } : {}),
      lockedAccess: (fn: () => void) => fn(), executeTransaction: (fn: (compound: any) => void) => { fn({ addAction: (action: any) => { action.apply(); return true; } }); return true; },
      createSequenceFromMedia: async (name: string) => { const sequence = { name, guid: { toString: () => "sequence" } }; createdSequences.push(sequence); return sequence; } };
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
    expect(result.sequence.id).toBe("sequence");
  });
  it.each([
    { label: "changed", guid: "other-project" },
    { label: "missing", guid: null },
    { label: "plain object", guid: {} },
    { label: "null stringifier", guid: { toString: () => null } },
    { label: "undefined stringifier", guid: { toString: () => undefined } },
    { label: "whitespace", guid: " " },
    { label: "unreadable", guid: { toString() { throw new Error("unreadable GUID"); } } },
  ])("rejects $label project GUID before mutation", async ({ guid }) => {
    const mutate = vi.fn();
    const project = { guid, lockedAccess: mutate, executeTransaction: mutate, createSequenceFromMedia: mutate };
    const command = api.createDialogueWorkflowDefinitions({ ppro: { Project: { getActiveProject: async () => project } } })["dialogue.deriveSequence"];
    await expect(command.handler({ operationId: "stale", plan: { schema_version: 1, project_guid: "project", mode: "talking_head", sequence_name: "Reviewed", segments: [
      { id: "one", source_project_item_id: "clip", source_start_seconds: 0, source_end_seconds: 1 },
    ], output_duration_seconds: 1, original_sources_unchanged: true, render_verified: false } })).rejects.toMatchObject({ code: "UXP_STALE_PROJECT" });
    expect(mutate).not.toHaveBeenCalled();
  });
  it("walks the project tree when the cast clip has no getParentBin", async () => {
    const children: any[] = [];
    const parent = { name: "Media", getId: async () => "bin", getItems: async () => children };
    const source = { name: "Source", getId: async () => "clip", isMulticamClip: async () => false,
      createSubClipAction: (name: string) => ({ apply: () => children.push({ name, getId: async () => `sub-${children.length + 1}` }) }) };
    children.push(source);
    const root = { getId: async () => "root", getItems: async () => [parent] };
    const createdSequences: any[] = [];
    const project = { getGuid: async () => "project", getRootItem: async () => root, getSequences: async () => createdSequences,
      lockedAccess: (fn: () => void) => fn(), executeTransaction: (fn: (compound: any) => void) => { fn({ addAction: (action: any) => { action.apply(); return true; } }); return true; },
      createSequenceFromMedia: async (name: string) => { const sequence = { name, getGuid: async () => "sequence" }; createdSequences.push(sequence); return sequence; } };
    const ppro = { Project: { getActiveProject: async () => project }, ClipProjectItem: { cast: (item: any) => item.createSubClipAction ? item : null }, FolderItem: { cast: (item: any) => item.getItems ? item : null },
      TickTime: { createWithSeconds: (seconds: number) => ({ seconds }) }, SequenceEditor: { getEditor: () => ({ createInsertProjectItemAction: () => ({ apply() {} }) }) } };
    const command = api.createDialogueWorkflowDefinitions({ ppro })["dialogue.deriveSequence"];
    const result = await command.handler({ operationId: "op-walk", plan: { schema_version: 1, project_guid: "project", mode: "talking_head", sequence_name: "Walked", segments: [
      { id: "one", source_project_item_id: "clip", transcript_revision: `sha256:${"a".repeat(64)}`, source_start_seconds: 0, source_end_seconds: 1 },
    ], output_duration_seconds: 1, original_sources_unchanged: true, render_verified: false } });
    expect(result).toMatchObject({ outcome: "committed_unverified", partial: false });
    expect(result.createdSubclips).toHaveLength(1);
  });
});
