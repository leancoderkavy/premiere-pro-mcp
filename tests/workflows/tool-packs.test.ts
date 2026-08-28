import { describe, expect, it } from "vitest";
import {
  buildToolPackReport,
  isToolInSelectedPacks,
  resolveToolPacks,
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
});
