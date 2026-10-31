import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PANEL_COMMAND_MARKER } from "../../src/bridge/file-bridge.js";

const require = createRequire(import.meta.url);
const root = process.cwd();
const panel = require(join(root, "cep-plugin", "panel-commands.cjs")) as {
  MARKER: string;
  isPanelCommand: (script: unknown) => boolean;
  run: (script: string, cep: unknown) => { success: boolean; data?: any; error?: string };
};

const installed = [
  { id: "com.example.panel", name: "Example", windowType: "Panel", isActive: false, basePath: "C:/x" },
  { id: "com.example.other", name: "Other", windowType: "ModalDialog", isActive: true },
];
function fakeCep(list: unknown = installed) {
  return {
    getExtensions: vi.fn(() => JSON.stringify(list)),
    requestOpenExtension: vi.fn(),
  };
}
const cmd = (payload: unknown) => `${PANEL_COMMAND_MARKER}${JSON.stringify(payload)}`;

describe("CEP panel-side commands", () => {
  it("uses the same marker as the server", () => {
    expect(panel.MARKER).toBe(PANEL_COMMAND_MARKER);
  });

  it("recognises a panel command only when the file starts with the marker", () => {
    expect(panel.isPanelCommand(cmd({ action: "list_extensions" }))).toBe(true);
    // Every ExtendScript command begins with the helper bootstrap, so a marker later in
    // the file (a string literal, a comment) never turns it into a panel command.
    expect(panel.isPanelCommand(`var helpers = 1;\n${cmd({ action: "list_extensions" })}`)).toBe(false);
    expect(panel.isPanelCommand(undefined)).toBe(false);
  });

  it("lists installed extensions with a bounded summary", () => {
    const result = panel.run(cmd({ action: "list_extensions" }), fakeCep());
    expect(result).toEqual({
      success: true,
      data: {
        count: 2,
        extensions: [
          { id: "com.example.panel", name: "Example", windowType: "Panel", isActive: false },
          { id: "com.example.other", name: "Other", windowType: "ModalDialog", isActive: true },
        ],
      },
    });
  });

  it("opens an installed extension by exact id and reports committed_unverified", () => {
    const cep = fakeCep();
    const result = panel.run(cmd({ action: "open_extension", extensionId: "com.example.panel", params: "" }), cep);
    expect(cep.requestOpenExtension).toHaveBeenCalledWith("com.example.panel", "");
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ extensionId: "com.example.panel", outcome: "committed_unverified", verified: false, wasActive: false });
  });

  it("refuses an id that is not installed, or only matches a display name", () => {
    const cep = fakeCep();
    for (const id of ["com.missing.panel", "Example"]) {
      const result = panel.run(cmd({ action: "open_extension", extensionId: id }), cep);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
    }
    expect(cep.requestOpenExtension).not.toHaveBeenCalled();
  });

  it("turns every failure into a result, never a throw", () => {
    expect(panel.run(`${PANEL_COMMAND_MARKER}{not json`, fakeCep()).success).toBe(false);
    expect(panel.run(cmd({ action: "close_everything" }), fakeCep()).error).toContain("Unknown panel command");
    expect(panel.run(cmd({ action: "list_extensions" }), null).success).toBe(false);
    const throwing = { getExtensions: () => { throw new Error("boom"); }, requestOpenExtension: vi.fn() };
    expect(panel.run(cmd({ action: "list_extensions" }), throwing).error).toContain("boom");
  });

  it("is loaded by the panel before main.js, and main.js answers it before ExtendScript", () => {
    const html = readFileSync(join(root, "cep-plugin", "index.html"), "utf8");
    expect(html.indexOf('src="panel-commands.cjs"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="panel-commands.cjs"')).toBeLessThan(html.indexOf('src="main.js"'));
    const main = readFileSync(join(root, "cep-plugin", "main.js"), "utf8");
    expect(main.indexOf("MCPPanelCommands.isPanelCommand(script)")).toBeLessThan(main.indexOf("executeScript(script, function (result)"));
  });
});
