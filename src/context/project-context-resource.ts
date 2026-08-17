export const PROJECT_CONTEXT_RESOURCE = JSON.stringify(
  {
    version: 1,
    purpose: "Reuse clip, audio, transcript, shot, and timeline context without sending the full Premiere project on every model turn.",
    workflow: [
      "Call manage_project_context with action=capture for the active sequence.",
      "Add expensive analysis once with action=enrich, using source_revision and timeline_revision guards when available.",
      "Call search_project_context with the user's edit intent and only the relevant context kinds.",
      "Use create_context_edit_plan to produce evidence candidates and expected revision guards.",
      "Re-capture if the sequence changed, resolve exact identities, then use preview_edit_plan before apply_edit_plan.",
    ],
    revisionRules: {
      sourceRevision: "Changes only when captured source-media identity changes; transcript, shot, and audio enrichments are reusable while it matches.",
      timelineRevision: "Changes when timeline placement changes; it guards plans without invalidating unchanged source analysis.",
      contextRevision: "Covers source state, timeline state, and enrichment content.",
    },
    privacy: [
      "Context is stored locally and only after an explicit tool call.",
      "Captured native media paths are hashed before persistence and are not returned by search.",
      "Do not store credentials, unrelated customer data, or sensitive notes that are unnecessary for editing.",
      "Use manage_project_context action=clear when the local context is no longer needed.",
    ],
    boundaries: [
      "Capture indexes active-sequence structure and source identity; it does not transcribe or visually analyze footage.",
      "Premiere transcript import/export support does not expose a documented API for starting Speech-to-Text.",
      "create_context_edit_plan is non-mutating and does not prove that a candidate is editorially correct.",
      "Every mutation still requires current Premiere identities, preview, authority checks, and post-state verification.",
    ],
  },
  null,
  2,
);
