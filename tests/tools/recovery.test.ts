import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/bridge/file-bridge.js")>();
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

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "premiere-recovery-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("recovery candidate discovery", () => {
  it("finds matching adjacent autosaves newest-first without modifying them", () => {
    const directory = temporaryDirectory();
    const project = join(directory, "Episode 01.prproj");
    writeFileSync(project, "project");
    const autosaveDirectory = join(directory, "Adobe Premiere Pro Auto-Save");
    mkdirSync(autosaveDirectory);
    const older = join(autosaveDirectory, "Episode 01-1.prproj");
    const newer = join(autosaveDirectory, "Episode 01-2.prproj");
    const unrelated = join(autosaveDirectory, "Other Project.prproj");
    writeFileSync(older, "old");
    writeFileSync(newer, "new");
    writeFileSync(unrelated, "unrelated");
    utimesSync(project, new Date(1_000), new Date(1_000));
    utimesSync(older, new Date(2_000), new Date(2_000));
    utimesSync(newer, new Date(3_000), new Date(3_000));

    const candidates = discoverAdjacentRecoveryCandidates(project);
    expect(candidates.map((item) => item.fileName)).toEqual([
      "Episode 01-2.prproj",
      "Episode 01-1.prproj",
    ]);
    expect(candidates.every((item) => item.newerThanProjectFile)).toBe(true);
    expect(readFileSync(newer, "utf8")).toBe("new");
  });

  it("does not scan when no saved Premiere project path exists", () => {
    expect(discoverAdjacentRecoveryCandidates("")).toEqual([]);
    expect(discoverAdjacentRecoveryCandidates("/tmp/not-a-project.txt")).toEqual([]);
  });
});

describe("privacy-preserving bridge telemetry", () => {
  it("does not report a quiet directory as healthy when no CEP heartbeat is present", () => {
    const directory = temporaryDirectory();
    expect(collectBridgeTelemetry({ tempDir: directory })).toMatchObject({
      directoryAccessible: true,
      heartbeat: { state: "unknown" },
      healthy: false,
    });
  });

  it("returns aggregate state without paths, filenames, or contents", () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "cmd_secret.jsx"), "private project script");
    writeFileSync(join(directory, "res_secret.json"), '{"project":"Private"}');
    writeFileSync(join(directory, "busy_secret.json"), "{}");
    writeFileSync(join(directory, "bridge-heartbeat.json"), JSON.stringify({
      protocolVersion: 1,
      state: "running",
    }));
    writeFileSync(join(directory, "helpers_ignored.jsx"), "helper");

    const telemetry = collectBridgeTelemetry(
      { tempDir: directory },
      Date.now() + 100,
    );
    expect(telemetry).toMatchObject({
      directoryAccessible: true,
      pendingCommands: 1,
      pendingResponses: 1,
      busyOperations: 1,
      heartbeat: { state: "running" },
      healthy: false,
    });
    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("Private");
  });
});

describe("recovery tools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the unavailable dirty flag and never emits restore code", async () => {
    const directory = temporaryDirectory();
    const project = join(directory, "Documentary.prproj");
    writeFileSync(project, "project");
    mockedSendCommand.mockResolvedValue({
      success: true,
      data: { name: "Documentary", path: project },
    });
    const tools = getRecoveryTools({ tempDir: join(directory, "bridge") });
    const result = await tools.inspect_project_recovery.handler();
    expect(result.success).toBe(true);
    expect((result.data as any).unsavedChanges).toMatchObject({
      status: "not_exposed",
      dirty: null,
    });
    expect((result.data as any).recovery.automaticRestoreSupported).toBe(false);
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).not.toContain("openDocument");
    expect(script).not.toContain("openProject");
    expect(script).not.toContain(".save");
  });
});

describe("bridge panel accessibility", () => {
  it("uses semantic live regions, labels, keyboard focus, and forced-colors CSS", () => {
    const cepHtml = readFileSync(
      new URL("../../cep-plugin/index.html", import.meta.url),
      "utf8",
    );
    const cepCss = readFileSync(
      new URL("../../cep-plugin/styles.css", import.meta.url),
      "utf8",
    );
    const uxpHtml = readFileSync(
      new URL("../../uxp-plugin/index.html", import.meta.url),
      "utf8",
    );
    expect(cepHtml).toContain('role="status"');
    expect(cepHtml).toContain('aria-label="Bridge activity log"');
    expect(cepHtml).toContain('tabindex="0"');
    expect(cepCss).toContain("@media (forced-colors: active)");
    expect(cepCss).toContain("focus-visible");
    expect(uxpHtml).toContain('role="status"');
    expect(uxpHtml).toContain('lang="en"');
  });
});
