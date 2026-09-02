import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsFaults = vi.hoisted(() => ({
  inaccessibleDirectories: new Set<string>(),
  vanishedFiles: new Set<string>(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      if (fsFaults.inaccessibleDirectories.has(resolve(String(args[0])))) {
        const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
        throw error;
      }
      return actual.readdirSync(...args);
    },
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      if (fsFaults.vanishedFiles.has(resolve(String(args[0])))) {
        const error = Object.assign(new Error("file disappeared"), { code: "ENOENT" });
        throw error;
      }
      return actual.statSync(...args);
    },
  };
});

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/bridge/file-bridge.js")>();
  return { ...actual, sendCommand: vi.fn() };
});

import { sendCommand } from "../../src/bridge/file-bridge.js";
import {
  collectBridgeTelemetry,
  discoverAdjacentRecoveryCandidates,
  getRecoveryTools,
} from "../../src/tools/recovery.js";

const mockedSendCommand = vi.mocked(sendCommand);
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-recovery-edge-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  fsFaults.inaccessibleDirectories.clear();
  fsFaults.vanishedFiles.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recovery discovery filesystem edges", () => {
  it("keeps an autosave for a missing project path but marks its project timestamp as unknown", () => {
    const directory = temporaryDirectory();
    const missingProject = join(directory, "Rough Cut.prproj");
    const autosaveDirectory = join(directory, "Premiere Pro Auto-Save");
    mkdirSync(autosaveDirectory);
    const autosave = join(autosaveDirectory, "Rough Cut backup.PRPROJ");
    writeFileSync(autosave, "autosave");
    mkdirSync(join(autosaveDirectory, "Rough Cut folder.prproj"));

    const candidates = discoverAdjacentRecoveryCandidates(missingProject);

    expect(candidates).toEqual([
      expect.objectContaining({
        path: autosave,
        fileName: "Rough Cut backup.PRPROJ",
        newerThanProjectFile: null,
      }),
    ]);
  });

  it("omits inaccessible autosave directories and candidates that disappear during inspection", () => {
    const directory = temporaryDirectory();
    const project = join(directory, "Episode.prproj");
    writeFileSync(project, "project");
    const inaccessibleAutosaves = join(directory, "Adobe Premiere Pro Auto-Save");
    mkdirSync(inaccessibleAutosaves);
    writeFileSync(join(inaccessibleAutosaves, "Episode inaccessible.prproj"), "autosave");
    fsFaults.inaccessibleDirectories.add(resolve(inaccessibleAutosaves));
    const vanishing = join(directory, "Episode vanishing.prproj");
    writeFileSync(vanishing, "autosave");
    fsFaults.vanishedFiles.add(resolve(vanishing));

    expect(discoverAdjacentRecoveryCandidates(project)).toEqual([]);
  });

  it("bounds discovery to fifty candidates even when more matching autosaves exist", () => {
    const directory = temporaryDirectory();
    const project = join(directory, "Assembly.prproj");
    writeFileSync(project, "project");
    const autosaveDirectory = join(directory, "Adobe Premiere Pro Auto-Save");
    mkdirSync(autosaveDirectory);
    for (let index = 0; index < 51; index++) {
      const candidate = join(autosaveDirectory, `Assembly-${String(index).padStart(2, "0")}.prproj`);
      writeFileSync(candidate, String(index));
      utimesSync(candidate, new Date(1_000 + index), new Date(1_000 + index));
    }

    const candidates = discoverAdjacentRecoveryCandidates(project);
    expect(candidates).toHaveLength(50);
    expect(candidates[0].modifiedMs).toBeGreaterThanOrEqual(candidates.at(-1)!.modifiedMs);
  });
});

describe("bridge telemetry filesystem edges", () => {
  it("remains useful when an individual pending file disappears", () => {
    const directory = temporaryDirectory();
    const pending = join(directory, "cmd_transient.jsx");
    writeFileSync(pending, "private script");
    fsFaults.vanishedFiles.add(resolve(pending));

    expect(collectBridgeTelemetry({ tempDir: directory }, 50_000)).toMatchObject({
      directoryAccessible: true,
      pendingCommands: 1,
      pendingResponses: 0,
      busyOperations: 0,
      oldestPendingAgeMs: null,
      healthy: false,
    });
  });

  it("reports an inaccessible bridge directory as unhealthy without exposing its details", async () => {
    const directory = temporaryDirectory();
    fsFaults.inaccessibleDirectories.add(resolve(directory));
    const tools = getRecoveryTools({ tempDir: directory });

    const result = await tools.get_bridge_telemetry.handler();
    expect(result).toMatchObject({
      success: true,
      data: {
        directoryAccessible: false,
        pendingCommands: 0,
        pendingResponses: 0,
        busyOperations: 0,
        healthy: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(directory);
  });

  it("marks an old response unhealthy while ignoring unrelated bridge files", () => {
    const directory = temporaryDirectory();
    const response = join(directory, "res_old.json");
    writeFileSync(response, "{}");
    writeFileSync(join(directory, "not-a-queue-file.txt"), "private");
    utimesSync(response, new Date(1_000), new Date(1_000));

    expect(collectBridgeTelemetry({ tempDir: directory }, 32_000)).toMatchObject({
      directoryAccessible: true,
      pendingCommands: 0,
      pendingResponses: 1,
      busyOperations: 0,
      oldestPendingAgeMs: 31_000,
      healthy: false,
    });
  });
});

describe("recovery inspection snapshots", () => {
  it.each([
    [null],
    [{}],
    [{ name: "Project", path: 17 }],
    [{ name: 17, path: "project.prproj" }],
  ])("rejects an invalid Premiere snapshot: %j", async (data) => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data });
    const result = await getRecoveryTools({ tempDir: temporaryDirectory() }).inspect_project_recovery.handler();
    expect(result).toEqual({ success: false, error: "Premiere returned an invalid project snapshot" });
  });

  it("preserves bridge failures instead of attempting local recovery discovery", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: false, error: "No project is open" });
    await expect(getRecoveryTools({ tempDir: temporaryDirectory() }).inspect_project_recovery.handler())
      .resolves.toEqual({ success: false, error: "No project is open" });
  });

  it("explains the unsaved-project boundary and missing saved project boundary distinctly", async () => {
    const tools = getRecoveryTools({ tempDir: temporaryDirectory() });
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { name: "Untitled", path: "" } });
    await expect(tools.inspect_project_recovery.handler()).resolves.toMatchObject({
      success: true,
      data: {
        project: { name: "Untitled", path: null, hasSavedPath: false, fileExists: false },
        recovery: {
          candidateCount: 0,
          guidance: expect.stringContaining("Save the project"),
        },
      },
    });

    const missingProject = join(temporaryDirectory(), "missing.prproj");
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { name: "Missing", path: missingProject } });
    await expect(tools.inspect_project_recovery.handler()).resolves.toMatchObject({
      success: true,
      data: {
        project: { name: "Missing", path: missingProject, hasSavedPath: true, fileExists: false },
        recovery: {
          candidateCount: 0,
          guidance: expect.stringContaining("No adjacent .prproj"),
        },
      },
    });
  });
});
