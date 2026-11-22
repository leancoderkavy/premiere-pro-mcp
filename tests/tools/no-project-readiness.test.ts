import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/bridge/file-bridge.js")>(),
  sendCommand: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getHealthTools } from "../../src/tools/health.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getScriptingTools } from "../../src/tools/scripting.js";

afterEach(() => vi.resetAllMocks());

const existingFile = fileURLToPath(import.meta.url);
const noProject = { success: false, error: "No project is open", data: { code: "NO_PROJECT_OPEN" } };

function host(project: unknown) {
  vi.mocked(sendCommand).mockImplementation(async (script) => JSON.parse(String(
    runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project } }),
  )));
  return {
    discovery: getDiscoveryTools({}),
    health: getHealthTools({}, undefined, undefined, { bridgeMode: "cep" }),
    scripting: getScriptingTools({}),
    media: getMediaTools({}),
  };
}

describe("no-project CEP diagnostics (issue 997)", () => {
  it.each([
    null,
    { name: "", path: "", rootItem: null, sequences: null },
    { name: "Premiere Pro", rootItem: null },
    { name: "", rootItem: {}, sequences: null },
  ])("refuses missing project without a TypeError: %j", async (project) => {
    const tools = host(project);
    await expect(tools.discovery.get_project_info.handler()).resolves.toMatchObject(noProject);
    await expect(tools.discovery.list_project_items.handler({})).resolves.toMatchObject(noProject);
    await expect(tools.discovery.list_sequences.handler()).resolves.toMatchObject(noProject);
    await expect(tools.scripting.get_premiere_state.handler()).resolves.toMatchObject(noProject);
    await expect(tools.media.import_media.handler({ file_paths: [existingFile] })).resolves.toMatchObject(noProject);
    await expect(tools.media.import_folder.handler({ folder_path: dirname(existingFile) })).resolves.toMatchObject(noProject);
  });

  it.each([null, { name: "Premiere Pro", rootItem: null }, { name: "", rootItem: {} }])(
    "reports missing project readiness: %j", async (project) => {
    const tools = host(project);
    const result = await tools.health.verify_premiere_connection.handler({ backend: "cep" });
    expect(result.data.overall).toBe("needs_attention");
    expect(result.data.components).toContainEqual(expect.objectContaining({
      code: "ACTIVE_PROJECT_MISSING", state: "needs_attention",
    }));
  });

  it.each(["", "C:/project.prproj"])("keeps open project output with path %j", async (path) => {
    const sequence = { name: "Edit", sequenceID: "seq-1", videoTracks: { numTracks: 1 }, audioTracks: { numTracks: 2 } };
    const tools = host({
      name: "Project", path, rootItem: { children: { numItems: 3 } },
      sequences: { numSequences: 1, 0: sequence }, activeSequence: sequence,
    });
    await expect(tools.discovery.get_project_info.handler()).resolves.toEqual({
      success: true, data: {
        name: "Project", path, numSequences: 1, numItems: 3,
        activeSequence: { name: "Edit", id: "seq-1", videoTracks: 1, audioTracks: 2 },
      },
    });
    const result = await tools.health.verify_premiere_connection.handler({ backend: "cep" });
    expect(result.data.overall).toBe("ready");
    expect(result.data.components).toContainEqual(expect.objectContaining({
      code: "ACTIVE_PROJECT_OPEN", state: "ready",
    }));
  });
});
