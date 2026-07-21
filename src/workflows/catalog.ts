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
