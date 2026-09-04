import { describe, expect, it } from "vitest";
import { getWorkflowRecipeTools, validateWorkflowRecipe } from "../../src/tools/workflow-recipes.js";

describe("workflow recipes", () => {
  it("expands only audited declarative routes", async () => {
    const tools = getWorkflowRecipeTools();
    const result = await tools.preview_workflow_recipe.handler({ recipe_id: "talking-head-cleanup", provided_inputs: ["source_project_item_id"] });
    expect(result.success).toBe(true);
    expect((result.data as any).applied).toBe(false);
    expect((result.data as any).execution_manifest[0].routes).toEqual(["verify_premiere_connection"]);
  });
  it("rejects arbitrary steps", () => expect(() => validateWorkflowRecipe({ schema_version: 1, id: "x", title: "X", description: "X", tags: [], required_inputs: [], steps: ["execute_extendscript"] })).toThrow(/unsupported/));
});
