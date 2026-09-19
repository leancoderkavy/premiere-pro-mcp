import { describe, expect, it } from "vitest";
import { buildPremiereInstructions } from "../../src/workflows/agent-instructions.js";
import { WORKFLOW_CATALOG, WORKFLOW_PROMPTS } from "../../src/workflows/catalog.js";

describe("premiere agent instructions", () => {
  it("teaches metadata layers even when no workflow tools are registered", () => {
    const text = buildPremiereInstructions(new Set());
    expect(text).toContain("METADATA:");
    expect(text).toContain("premiere://project/metadata");
    expect(text).toContain("item_columns");
    expect(text).toContain("Adobe exposes no field-level schema enumerator");
    expect(text).not.toContain("inspect_project_panel_metadata_uxp ->");
    expect(text).not.toContain("get_metadata ->");
  });

  it("includes metadata routes only when those tools are registered", () => {
    const columns = buildPremiereInstructions(new Set(["inspect_project_panel_metadata_uxp"]));
    expect(columns).toContain("- inspect_project_panel_metadata_uxp:");
    expect(columns.split("AVAILABLE WORKFLOW ROUTES:\n")[1]).not.toContain("manage_metadata_uxp");

    const packets = buildPremiereInstructions(new Set(["get_metadata", "get_xmp_metadata"]));
    expect(packets).toContain("get_metadata -> get_xmp_metadata");

    const uxpWrite = buildPremiereInstructions(new Set([
      "inspect_project_panel_metadata_uxp",
      "manage_metadata_uxp",
    ]));
    expect(uxpWrite).toContain("inspect_project_panel_metadata_uxp -> manage_metadata_uxp");
    expect(uxpWrite).toContain("Do not retry a failed UXP write through CEP");

    const cepWrite = buildPremiereInstructions(new Set(["get_metadata", "set_metadata"]));
    expect(cepWrite).toContain("get_metadata -> set_metadata");
    expect(cepWrite).toContain("parse_fields");
    expect(cepWrite).toContain("field_name");
  });
});

describe("metadata-review workflow prompt", () => {
  it("ships clip-metadata guidance on the dedicated prompt", () => {
    expect(WORKFLOW_CATALOG.some((workflow) => workflow.id === "metadata-review")).toBe(true);
    const prompt = WORKFLOW_PROMPTS.find((entry) => entry.name === "premiere-metadata-review");
    expect(prompt?.description).toContain("Project-panel columns");
    const rendered = prompt!.render({ goal: "fill Scene and Take" });
    expect(rendered.messages[0].content.text).toContain("fill Scene and Take");
    expect(rendered.messages[0].content.text).toContain("item_columns");
    expect(rendered.messages[0].content.text).toContain("never fall back from a failed UXP write to CEP");
  });
});
