import { describe, expect, it } from "vitest";
import {
  buildToolPackReport,
  isToolInSelectedPacks,
  parseExplicitToolList,
  resolveToolPacks,
  unknownExplicitTools,
} from "../../src/workflows/tool-packs.js";

describe("workflow tool packs", () => {
  it("keeps the backwards-compatible full catalog when unconfigured", () => {
    expect(resolveToolPacks(undefined, "default")).toEqual({
      source: "default",
      selected: [],
      fullCatalog: true,
    });
  });

  it("unions explicit packs without granting tools outside them", () => {
    const selection = resolveToolPacks("essential, delivery, essential", "explicit");
    expect(selection).toMatchObject({
      source: "explicit",
      selected: ["essential", "delivery"],
      fullCatalog: false,
    });
    expect(isToolInSelectedPacks("get_project_info", selection)).toBe(true);
    expect(isToolInSelectedPacks("export_aaf", selection)).toBe(true);
    expect(isToolInSelectedPacks("create_bin", selection)).toBe(false);

    const report = buildToolPackReport(selection);
    expect(report.selected).toEqual(["essential", "delivery"]);
    expect(report.note).toContain("do not grant capabilities");
  });

  it("rejects ambiguous or unknown configuration", () => {
    expect(() => resolveToolPacks("full,inspection", "explicit")).toThrow(/cannot combine/i);
    expect(() => resolveToolPacks("unknown", "explicit")).toThrow(/Unknown Premiere MCP tool pack/i);
    expect(() => resolveToolPacks(",", "explicit")).toThrow(/must select full or at least one pack/i);
  });

  it("narrows to an explicit tool list without any pack", () => {
    const selection = resolveToolPacks(undefined, undefined, "get_project_info, save_project,get_project_info");
    expect(selection).toEqual({
      source: "environment",
      selected: [],
      fullCatalog: false,
      explicitTools: ["get_project_info", "save_project"],
    });
    expect(isToolInSelectedPacks("get_project_info", selection)).toBe(true);
    expect(isToolInSelectedPacks("ping", selection)).toBe(true);
    expect(isToolInSelectedPacks("get_capabilities", selection)).toBe(true);
    expect(isToolInSelectedPacks("create_bin", selection)).toBe(false);
    expect(buildToolPackReport(selection).explicitTools).toEqual(["get_project_info", "save_project"]);
  });

  it("unions an explicit tool list with the selected packs", () => {
    const selection = resolveToolPacks("essential", "explicit", "create_bin");
    expect(selection.selected).toEqual(["essential"]);
    expect(selection.explicitTools).toEqual(["create_bin"]);
    expect(isToolInSelectedPacks("create_bin", selection)).toBe(true);
    expect(isToolInSelectedPacks("get_project_info", selection)).toBe(true);
    expect(isToolInSelectedPacks("delete_bin", selection)).toBe(false);
  });

  it("keeps the full catalog when full is selected alongside a list", () => {
    const selection = resolveToolPacks("full", "explicit", "create_bin");
    expect(selection.fullCatalog).toBe(true);
    expect(selection.explicitTools).toBeUndefined();
    expect(buildToolPackReport(selection).explicitTools).toEqual([]);
  });

  it("accepts newline-separated pack files and rejects malformed names", () => {
    expect(parseExplicitToolList("get_project_info\nsave_project\n")).toEqual(["get_project_info", "save_project"]);
    expect(parseExplicitToolList(undefined)).toEqual([]);
    expect(() => parseExplicitToolList("get-project-info")).toThrow(/not a tool name/i);
    expect(() => parseExplicitToolList("Get_Project_Info")).toThrow(/not a tool name/i);
  });

  it("reports listed names that no known tool matches", () => {
    const selection = resolveToolPacks(undefined, undefined, "get_project_info,nope_tool");
    expect(unknownExplicitTools(selection, ["get_project_info", "ping"])).toEqual(["nope_tool"]);
    expect(unknownExplicitTools(resolveToolPacks(undefined, "default"), [])).toEqual([]);
  });
});
