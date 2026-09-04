import { describe, expect, it } from "vitest";
import { getWorkflowRecipeTools, validateWorkflowRecipe } from "../../src/tools/workflow-recipes.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("workflow recipes", () => {
  it("expands only audited declarative routes", async () => {
    const tools = getWorkflowRecipeTools();
    const result = await tools.preview_workflow_recipe.handler({ recipe_id: "talking-head-cleanup", provided_inputs: ["source_project_item_id"] });
    expect(result.success).toBe(true);
    expect((result.data as any).applied).toBe(false);
    expect((result.data as any).execution_manifest[0].routes).toEqual(["verify_premiere_connection"]);
  });
  it("rejects arbitrary steps", () => expect(() => validateWorkflowRecipe({ schema_version: 1, id: "x", title: "X", description: "X", tags: [], required_inputs: [], steps: ["execute_extendscript"] })).toThrow(/unsupported/));
  it("loads a contained custom recipe and rejects conflicts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "recipes-")), file = path.join(root, "recipes.json");
    const recipe = { schema_version: 1, id: "custom", title: "Custom", description: "Custom", tags: ["one"], required_inputs: [], steps: ["verify_connection"] };
    writeFileSync(file, JSON.stringify([recipe]));
    const tools = getWorkflowRecipeTools();
    expect((await tools.search_workflow_recipes.handler({ query: "custom", approved_workspace_path: root, recipe_file: file })).success).toBe(true);
    writeFileSync(file, JSON.stringify([{ ...recipe, id: "talking-head-cleanup" }]));
    expect((await tools.search_workflow_recipes.handler({ approved_workspace_path: root, recipe_file: file })).success).toBe(false);
  });
  it.each([null, [], { schema_version: 2 }, { schema_version: 1, id: "x", title: "X", description: "X", steps: [] }, { schema_version: 1, id: "x", title: "X", description: "X", tags: ["a", "a"], required_inputs: [], steps: ["verify_connection"] }])("rejects invalid recipe %#", (recipe) => expect(() => validateWorkflowRecipe(recipe)).toThrow());
  it("fails closed for malformed and escaped custom files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "recipes-")), outside = mkdtempSync(path.join(tmpdir(), "recipes-out-"));
    const tools = getWorkflowRecipeTools();
    writeFileSync(path.join(outside, "r.json"), "[]");
    expect((await tools.search_workflow_recipes.handler({ approved_workspace_path: root, recipe_file: path.join(outside, "r.json") })).success).toBe(false);
    const file = path.join(root, "r.json"); writeFileSync(file, "not json");
    expect((await tools.search_workflow_recipes.handler({ approved_workspace_path: root, recipe_file: file })).success).toBe(false);
    writeFileSync(file, "{}"); expect((await tools.search_workflow_recipes.handler({ approved_workspace_path: root, recipe_file: file })).success).toBe(false);
    expect((await tools.search_workflow_recipes.handler({ approved_workspace_path: root })).success).toBe(false);
    expect((await tools.preview_workflow_recipe.handler({ recipe_id: "missing" })).success).toBe(false);
    expect((await tools.preview_workflow_recipe.handler({ recipe_id: "talking-head-cleanup", provided_inputs: [1] })).success).toBe(false);
  });
  it("reports ready built-ins and custom recipe sources", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "recipes-")), file = path.join(root, "r.json");
    writeFileSync(file, JSON.stringify([{ schema_version: 1, id: "custom-ready", title: "Custom", description: "Custom", tags: [], required_inputs: [], steps: ["verify_connection"] }]));
    const tools = getWorkflowRecipeTools();
    const custom = await tools.search_workflow_recipes.handler({ approved_workspace_path: root, recipe_file: file }) as any;
    expect(custom.data.recipes.find((item: any) => item.id === "custom-ready").source).toBe("workspace_file");
    const provided_inputs = ["source_project_item_id", "transcript_revision", "approved_segments", "sequence_name"];
    expect(((await tools.preview_workflow_recipe.handler({ recipe_id: "talking-head-cleanup", provided_inputs })) as any).data.ready).toBe(true);
  });
});
