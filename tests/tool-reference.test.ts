import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildToolReference } from "../scripts/tool-reference-data.mjs";
import { filterTools } from "../landing/lib/tool-reference.js";
import source from "../release-metadata.json";

const markdown = readFileSync("docs/supported-actions.md", "utf8");
const catalog = buildToolReference(markdown, source);

describe("source tool reference", () => {
  it("ships the full generated catalog with separate authority surfaces and provenance", () => {
    expect(JSON.parse(readFileSync("landing/public/tool-catalog.json", "utf8"))).toEqual(catalog);
    expect(catalog.evidenceScope).toBe("source_catalog_may_include_unreleased_work");
    expect(catalog.hostVerification).toBe("not_established_by_catalogs");
    expect(catalog.tools.find((tool) => tool.name === "execute_extendscript")?.surface).toBe("restricted");
    expect(catalog.tools.find((tool) => tool.name === "verify_premiere_connection")?.surface).toBe("default");
    expect(buildToolReference(markdown.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), source)).toEqual(catalog);
  });

  it("rejects duplicate, missing, or malformed tool rows rather than publishing an incomplete reference", () => {
    const row = markdown.split(/\r?\n/).find((line) => line.startsWith("| `"))!;
    expect(() => buildToolReference(`${markdown}\n${row}`, source)).toThrow("Duplicate");
    expect(() => buildToolReference(markdown.replace(row, ""), source)).toThrow("counts");
    expect(() => buildToolReference(markdown.replace(row, "| `broken-name` | Default profile | Single operation | Description |"), source)).toThrow("Unexpected");
    expect(() => buildToolReference(markdown.replace(row, row.replace("Default profile", "Unknown profile")), source)).toThrow("Unexpected");
  });

  it("preserves escaped table content and action modes", () => {
    const fixture = "| `inspect_test` | Default profile | `action`: `inspect`, `preview` | Inspect A \\| B. |";
    const result = buildToolReference(fixture, { version: "test", defaultProfileTools: 1, coreTools: 1, uxpAdditionalTools: 0, defaultProfileWithUxpTools: 1 });
    expect(result.tools[0]).toEqual({ name: "inspect_test", surface: "default", modes: "action: inspect, preview", description: "Inspect A | B." });
  });
});

describe("tool search", () => {
  const tools = [
    { name: "get_project_info", surface: "default", description: "Inspect project state", modes: "Single operation" },
    { name: "uxp_test", surface: "uxp", description: "Inspect project clips", modes: "action: audit, preview" },
    { name: "execute_extendscript", surface: "restricted", description: "Run a script", modes: "Single operation" },
  ];
  it("matches all words across names, descriptions, and modes without changing catalog order", () => {
    expect(filterTools(tools, "  PROJECT info ", "all")).toEqual([tools[0]]);
    expect(filterTools(tools, "get_project_info", "all")).toEqual([tools[0]]);
    expect(filterTools(tools, "project preview", "all")).toEqual([tools[1]]);
    expect(filterTools(tools, "", "all")).toEqual(tools);
  });
  it("intersects the query with availability and handles empty results and literal punctuation", () => {
    expect(filterTools(tools, "project", "default")).toEqual([tools[0]]);
    expect(filterTools(tools, "", "restricted")).toEqual([tools[2]]);
    expect(filterTools(tools, "project", "restricted")).toEqual([]);
    expect(filterTools(tools, "[.*", "all")).toEqual([]);
    expect(filterTools(tools, "", "unknown")).toEqual([]);
  });
});
