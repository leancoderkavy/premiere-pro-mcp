import { z } from "zod";

export const WORKFLOW_CATALOG = [
  {
    id: "rough-cut",
    title: "Assemble a rough cut",
    summary: "Inspect the project, import media, create or select a sequence, assemble clips, then verify and save.",
    recommendedTools: ["get_premiere_state", "import_media", "create_sequence", "add_to_timeline", "get_sequence_structure", "save_project"],
  },
  {
    id: "dialogue-cleanup",
    title: "Clean up dialogue",
    summary: "Inspect audio tracks, normalize dialogue, apply conservative cleanup, and verify levels before saving.",
    recommendedTools: ["get_sequence_structure", "adjust_audio_levels", "apply_audio_effect", "save_project"],
  },
  {
    id: "caption-and-style",
    title: "Caption and style a sequence",
    summary: "Inspect the active sequence, create captions, apply styling, verify timing, and save.",
    recommendedTools: ["get_active_sequence", "create_caption_track", "get_sequence_structure", "save_project"],
  },
  {
    id: "delivery",
    title: "Prepare a delivery export",
    summary: "Validate the sequence and destination, export with an explicit preset, then report the produced artifact.",
    recommendedTools: ["get_premiere_state", "get_active_sequence", "export_sequence"],
  },
  {
    id: "contextual-rough-cut",
    title: "Build a context-aware rough cut",
    summary: "Capture reusable project context, retrieve only evidence relevant to the edit intent, create a revision-guarded plan, then preview before applying.",
    recommendedTools: ["manage_project_context", "search_project_context", "create_context_edit_plan", "preview_edit_plan", "apply_edit_plan"],
  },
  {
    id: "transcript-rough-cut",
    title: "Plan a transcript-driven rough cut",
    summary: "Export Premiere's native transcript, select revision-locked source ranges, map them to verified 1x placements in a duplicate sequence, then execute the descending cut plan with re-query verification.",
    recommendedTools: ["get_clip_transcript_uxp", "search_clip_transcript_uxp", "preview_transcript_edit_uxp", "plan_transcript_rough_cut_uxp", "manage_sequences_uxp", "split_clip", "get_sequence_structure"],
  },
  {
    id: "project-organization",
    title: "Plan project organization",
    summary: "Capture project context, supply explicit editorial categories, create and preview a review-only organization plan, then use its guarded apply route with stable-ID bin operations. Direct organize_project_items_uxp use is advanced/manual only.",
    recommendedTools: ["manage_project_context", "create_editorial_plan", "preview_editorial_plan", "apply_editorial_organization_plan"],
  },
  {
    id: "ai-assisted-stringout",
    title: "Plan a reviewed stringout",
    summary: "Retrieve relevant local evidence, produce a review-only stringout plan, resolve selected project items, then create and verify a new sequence.",
    recommendedTools: ["manage_project_context", "create_editorial_plan", "preview_editorial_plan", "manage_sequences_uxp", "edit_timeline_uxp"],
  },
  {
    id: "caption-artifact-review",
    title: "Review a caption artifact",
    summary: "Use existing transcript evidence to review a supplied caption artifact, import it deliberately, create a caption track, and verify playback before delivery.",
    recommendedTools: ["manage_project_context", "create_editorial_plan", "preview_editorial_plan", "import_media", "create_caption_track", "get_sequence_structure"],
  },
  {
    id: "platform-cutdown",
    title: "Plan platform cutdowns",
    summary: "Capture source-sequence context, propose bounded platform dimensions, review derivative sequence routes, then create and verify each cutdown deliberately.",
    recommendedTools: ["manage_project_context", "create_editorial_plan", "preview_editorial_plan", "manage_sequences_uxp", "auto_reframe_sequence", "get_sequence_structure", "export_sequence"],
  },
] as const;

export const WORKFLOW_RESOURCE = JSON.stringify(
  {
    version: 1,
    guidance: [
      "Inspect current state before mutating the project.",
      "Re-query clip identifiers after timeline edits.",
      "Ask for confirmation before destructive edits or final exports when intent is ambiguous.",
      "Verify the resulting sequence and save only after successful edits.",
    ],
    workflows: WORKFLOW_CATALOG,
  },
  null,
  2,
);

const commonArgs = {
  goal: z.string().describe("What the finished edit should accomplish"),
  constraints: z.string().optional().describe("Timing, style, media, or delivery constraints"),
};

export const WORKFLOW_PROMPTS = WORKFLOW_CATALOG.map((workflow) => ({
  name: `premiere-${workflow.id}`,
  title: workflow.title,
  description: workflow.summary,
  argsSchema: commonArgs,
  render: ({ goal, constraints }: { goal: string; constraints?: string }) => ({
    description: `${workflow.title}: ${goal}`,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Use the ${workflow.title.toLowerCase()} workflow to accomplish: ${goal}`,
            constraints ? `Constraints: ${constraints}` : undefined,
            `Begin with project inspection. Prefer these tools when applicable: ${workflow.recommendedTools.join(", ")}.`,
            "Before each mutation, validate the active project/sequence and relevant identifiers. After editing, inspect the result and clearly report completed, skipped, and failed steps.",
          ].filter(Boolean).join("\n"),
        },
      },
    ],
  }),
}));
