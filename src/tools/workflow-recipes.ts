import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const MAX_RECIPE_BYTES = 1024 * 1024;
const MAX_RECIPES = 64;
const MAX_STEPS = 24;

const STEP_ROUTES = {
  verify_connection: ["verify_premiere_connection"],
  inspect_sequence: ["get_active_sequence", "get_sequence_structure"],
  export_transcript: ["get_clip_transcript_uxp"],
  analyze_dialogue: ["analyze_dialogue_edit_candidates"],
  preview_dialogue_derivative: ["preview_derived_dialogue_sequence_uxp"],
  apply_dialogue_derivative: ["apply_derived_dialogue_sequence_uxp"],
  detect_silence: ["detect_silence"],
  inspect_watched_media: ["manage_media_watch", "preview_watched_media_import"],
  import_approved_media: ["import_project_media_uxp"],
  clone_sequence: ["manage_sequences_uxp"],
  auto_reframe: ["auto_reframe_sequence"],
  caption_artifact: ["create_caption_track"],
  verify_sequence: ["get_sequence_structure", "inspect_sequence_review_report"],
  review_frames: ["export_sequence_review_frames"],
  export_delivery: ["validate_project_for_export", "export_sequence", "verify_delivery_file"],
} as const;

export type WorkflowRecipeStep = keyof typeof STEP_ROUTES;
export type WorkflowRecipe = {
  schema_version: 1;
  id: string;
  title: string;
  description: string;
  tags: string[];
  required_inputs: string[];
  steps: WorkflowRecipeStep[];
};

const BUILT_INS: readonly WorkflowRecipe[] = [
  { schema_version: 1, id: "talking-head-cleanup", title: "Talking-head cleanup", description: "Review transcript and silence evidence, then create and verify a dialogue-cleaned derivative sequence.", tags: ["dialogue", "rough-cut"], required_inputs: ["source_project_item_id", "transcript_revision", "approved_segments", "sequence_name"], steps: ["verify_connection", "export_transcript", "detect_silence", "analyze_dialogue", "preview_dialogue_derivative", "apply_dialogue_derivative", "verify_sequence"] },
  { schema_version: 1, id: "podcast-first-cut", title: "Podcast first cut", description: "Review speaker and camera assignments, then create a standard derivative sequence with continuous approved master audio.", tags: ["podcast", "multicamera", "rough-cut"], required_inputs: ["camera_source_ids", "master_audio_project_item_id", "approved_segments", "sequence_name"], steps: ["verify_connection", "inspect_sequence", "export_transcript", "analyze_dialogue", "preview_dialogue_derivative", "apply_dialogue_derivative", "verify_sequence"] },
  { schema_version: 1, id: "shorts-cutdown", title: "Shorts cutdown", description: "Create a reviewed dialogue derivative, clone it, reframe it, add a supplied caption artifact, and verify delivery evidence.", tags: ["social", "vertical", "captions"], required_inputs: ["approved_segments", "target_dimensions", "caption_artifact", "export_preset"], steps: ["verify_connection", "preview_dialogue_derivative", "apply_dialogue_derivative", "clone_sequence", "auto_reframe", "caption_artifact", "review_frames", "export_delivery"] },
  { schema_version: 1, id: "watched-media-intake", title: "Watched-media intake", description: "Review new or changed files in an approved local folder before importing selected media into Premiere.", tags: ["intake", "media", "organization"], required_inputs: ["approved_workspace_path", "watch_path", "allowed_extensions"], steps: ["verify_connection", "inspect_watched_media", "import_approved_media", "verify_sequence"] },
];

function requiredText(value: unknown, label: string, max = 255): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function containedFile(workspace: string, candidate: string): string {
  if (!path.isAbsolute(workspace) || !path.isAbsolute(candidate)) throw new Error("approved_workspace_path and recipe_file must be absolute paths");
  const root = realpathSync(workspace);
  const file = realpathSync(candidate);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("recipe_file must be contained within approved_workspace_path");
  if (!statSync(file).isFile()) throw new Error("recipe_file must be a regular file");
  return file;
}

export function validateWorkflowRecipe(value: unknown, label = "recipe"): WorkflowRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const input = value as Record<string, unknown>;
  const allowed = ["schema_version", "id", "title", "description", "tags", "required_inputs", "steps"];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has an unknown field: ${unknown}`);
  if (input.schema_version !== 1) throw new Error(`${label}.schema_version must be 1`);
  const strings = (raw: unknown, field: string, maxItems: number) => {
    if (!Array.isArray(raw) || raw.length > maxItems) throw new Error(`${field} must be an array with at most ${maxItems} entries`);
    const values = raw.map((item, index) => requiredText(item, `${field}[${index}]`, 128));
    if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicates`);
    return values;
  };
  const rawSteps = strings(input.steps, `${label}.steps`, MAX_STEPS);
  if (!rawSteps.length) throw new Error(`${label}.steps must not be empty`);
  const steps = rawSteps.map((step) => {
    if (!(step in STEP_ROUTES)) throw new Error(`${label}.steps contains unsupported declarative step: ${step}`);
    return step as WorkflowRecipeStep;
  });
  return {
    schema_version: 1,
    id: requiredText(input.id, `${label}.id`, 128),
    title: requiredText(input.title, `${label}.title`),
    description: requiredText(input.description, `${label}.description`, 1000),
    tags: strings(input.tags ?? [], `${label}.tags`, 16),
    required_inputs: strings(input.required_inputs ?? [], `${label}.required_inputs`, 32),
    steps,
  };
}

function customRecipes(workspace?: unknown, file?: unknown): WorkflowRecipe[] {
  if (workspace === undefined && file === undefined) return [];
  const workspacePath = requiredText(workspace, "approved_workspace_path", 4096);
  const filePath = containedFile(workspacePath, requiredText(file, "recipe_file", 4096));
  if (statSync(filePath).size > MAX_RECIPE_BYTES) throw new Error("recipe_file exceeds 1 MiB");
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length > MAX_RECIPES) throw new Error(`recipe_file must contain a JSON array of at most ${MAX_RECIPES} recipes`);
  const recipes = parsed.map((entry, index) => validateWorkflowRecipe(entry, `recipes[${index}]`));
  const ids = new Set(BUILT_INS.map((recipe) => recipe.id));
  for (const recipe of recipes) {
    if (ids.has(recipe.id)) throw new Error(`recipe id conflicts with another recipe: ${recipe.id}`);
    ids.add(recipe.id);
  }
  return recipes;
}

function recipeDigest(recipe: WorkflowRecipe): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(recipe)).digest("hex")}`;
}

export function getWorkflowRecipeTools() {
  const customProperties = {
    approved_workspace_path: { type: "string", maxLength: 4096, description: "Absolute approved workspace containing recipe_file; required with recipe_file." },
    recipe_file: { type: "string", maxLength: 4096, description: "Optional contained JSON file with closed-schema custom recipes." },
  };
  return {
    search_workflow_recipes: {
      description: "Search audited built-in and explicitly supplied workspace-local workflow recipes. Recipes are declarative previews and cannot execute arbitrary tools or scripts.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        query: { type: "string", maxLength: 256, description: "Optional case-insensitive title, description, tag, or ID query." },
        ...customProperties,
      } },
      handler: async (args: Record<string, unknown>) => {
        try {
          const query = typeof args.query === "string" ? args.query.trim().toLocaleLowerCase() : "";
          const recipes = [...BUILT_INS, ...customRecipes(args.approved_workspace_path, args.recipe_file)].filter((recipe) => !query || `${recipe.id} ${recipe.title} ${recipe.description} ${recipe.tags.join(" ")}`.toLocaleLowerCase().includes(query));
          return { success: true, data: { recipes: recipes.map((recipe) => ({ id: recipe.id, title: recipe.title, description: recipe.description, tags: recipe.tags, source: BUILT_INS.some((item) => item.id === recipe.id) ? "built_in" : "workspace_file" })), count: recipes.length } };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
    preview_workflow_recipe: {
      description: "Validate and expand one declarative workflow recipe into guarded MCP routes. It does not invoke any route or change Premiere.",
      parameters: { type: "object" as const, additionalProperties: false, properties: {
        recipe_id: { type: "string", minLength: 1, maxLength: 128, description: "Exact built-in or workspace recipe ID." },
        provided_inputs: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 128 }, description: "Names of inputs already available to the caller; values are intentionally not persisted in the recipe preview." },
        ...customProperties,
      }, required: ["recipe_id"] },
      handler: async (args: Record<string, unknown>) => {
        try {
          const id = requiredText(args.recipe_id, "recipe_id", 128);
          const recipe = [...BUILT_INS, ...customRecipes(args.approved_workspace_path, args.recipe_file)].find((item) => item.id === id);
          if (!recipe) throw new Error(`workflow recipe not found: ${id}`);
          const provided = Array.isArray(args.provided_inputs) ? args.provided_inputs.map((item, index) => requiredText(item, `provided_inputs[${index}]`, 128)) : [];
          const missing = recipe.required_inputs.filter((name) => !provided.includes(name));
          return { success: true, data: { recipe: { ...recipe, digest: recipeDigest(recipe) }, missing_inputs: missing, ready: missing.length === 0, applied: false, execution_manifest: recipe.steps.map((step, index) => ({ index, step, routes: [...STEP_ROUTES[step]], authority: "Each route retains its own capability, revision, confirmation, and verification checks." })) } };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
      },
    },
  };
}
