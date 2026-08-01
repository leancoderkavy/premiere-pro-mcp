import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");

const ADOBE_26_3_COMMANDS = [
  "track.rename",
  "subclip.create",
  "marker.list",
  "sourceMonitor.position.set",
  "interchange.aaf.export",
] as const;

function registryWithAdobe26_3Apis() {
  const track = { createSetNameAction: vi.fn(() => ({ kind: "rename" })) };
  const sequence = {
    guid: "sequence-26-3",
    getAudioTrackCount: vi.fn(async () => 1),
    getAudioTrack: vi.fn(async () => track),
    getVideoTrackCount: vi.fn(async () => 1),
    getVideoTrack: vi.fn(async () => track),
    getCaptionTrackCount: vi.fn(async () => 1),
    getCaptionTrack: vi.fn(async () => track),
  };
  const project = {
    guid: "project-26-3",
    getActiveSequence: vi.fn(async () => sequence),
  };
  const ppro = {
    Project: { getActiveProject: vi.fn(async () => project) },
    ClipProjectItem: { cast: vi.fn((item: unknown) => item) },
    Markers: { getMarkers: vi.fn(async () => []) },
    SourceMonitor: {
      setPosition: vi.fn(async () => true),
      getPosition: vi.fn(async () => ({ seconds: 0 })),
    },
    TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
    Transcript: {
      hasTranscript: vi.fn(() => false),
      exportToJSON: vi.fn(async () => ""),
    },
    ProjectConverter: { exportAAF: vi.fn(async () => true) },
    AAFExportOptions: vi.fn(() => ({})),
  };
  return Commands.createCommandRegistry({ ppro, fs: {}, Protocol });
}

describe("Adobe Premiere 26.3 UXP capability catalog", () => {
  it("reports every planned documented command as a supported 26.3 capability", async () => {
    const registry = registryWithAdobe26_3Apis();
    const capabilities = await registry.capabilities();

    expect(Object.keys(capabilities.commands)).toEqual(
      expect.arrayContaining(ADOBE_26_3_COMMANDS),
    );
    for (const command of ADOBE_26_3_COMMANDS) {
      expect(capabilities.commands[command]).toMatchObject({
        supported: true,
        backend: "uxp",
        documented: true,
        minHostVersion: "26.3.0",
      });
    }
    expect(capabilities.commands["track.rename"]).toMatchObject({
      destructive: true,
      undoable: true,
      readOnly: false,
    });
    expect(capabilities.commands["subclip.create"]).toMatchObject({
      destructive: true,
      undoable: true,
      readOnly: false,
    });
    expect(capabilities.commands["marker.list"]).toMatchObject({ readOnly: true });
  });

  it("does not infer 26.3 support from the version when the native APIs are absent", async () => {
    const registry = Commands.createCommandRegistry({
      ppro: {
        Project: {
          getActiveProject: vi.fn(async () => ({
            getActiveSequence: vi.fn(async () => ({})),
          })),
        },
        TickTime: { createWithSeconds: vi.fn((seconds: number) => ({ seconds })) },
      },
      fs: {},
      Protocol,
    });
    const capabilities = await registry.capabilities();

    for (const command of ADOBE_26_3_COMMANDS) {
      expect(capabilities.commands[command]).toMatchObject({
        supported: false,
        backend: "uxp",
        documented: true,
        minHostVersion: "26.3.0",
        reason: expect.any(String),
      });
    }
  });
});
