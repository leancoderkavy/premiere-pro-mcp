import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readdirSync: mocks.readdirSync,
  statSync: mocks.statSync,
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.PREMIERE_DEFAULT_SEQUENCE_PRESET;
  mocks.existsSync.mockReturnValue(true);
  mocks.statSync.mockReturnValue({ isDirectory: () => false });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("default sequence preset discovery", () => {
  it("uses and caches an explicit existing preset", async () => {
    process.env.PREMIERE_DEFAULT_SEQUENCE_PRESET = "C:\\Presets\\Explicit.sqpreset";
    const { findDefaultSequencePreset } = await import("../../src/tools/sequence.js");
    expect(findDefaultSequencePreset()).toBe("C:\\Presets\\Explicit.sqpreset");
    mocks.existsSync.mockReturnValue(false);
    expect(findDefaultSequencePreset()).toBe("C:\\Presets\\Explicit.sqpreset");
  });

  it("selects the preferred Windows preset while skipping unrelated installs", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.readdirSync.mockImplementation((directory) => {
      const path = String(directory);
      if (path === "C:\\Program Files\\Adobe") return ["Unrelated", "Adobe Premiere Pro 2026"] as never;
      if (path.endsWith("SequencePresets")) {
        return ["Other.sqpreset", "UHD (4K) 2160p 25 fps.sqpreset"] as never;
      }
      return [] as never;
    });
    const { findDefaultSequencePreset } = await import("../../src/tools/sequence.js");
    expect(findDefaultSequencePreset()).toMatch(/UHD \(4K\) 2160p 25 fps\.sqpreset$/);
  });

  it("walks a macOS app bundle and falls back to any preset", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    mocks.readdirSync.mockImplementation((directory) => {
      const path = String(directory);
      if (path === "/Applications") return ["Adobe Premiere Pro 2026"] as never;
      if (path.endsWith("Adobe Premiere Pro 2026")) return ["Adobe Premiere Pro.app", "README"] as never;
      if (path.endsWith("SequencePresets")) return ["Cinema.sqpreset"] as never;
      return [] as never;
    });
    const { findDefaultSequencePreset } = await import("../../src/tools/sequence.js");
    expect(findDefaultSequencePreset()).toMatch(/Cinema\.sqpreset$/);
  });

  it("returns and caches null when installation discovery fails", async () => {
    mocks.readdirSync.mockImplementation(() => { throw new Error("access denied"); });
    const { findDefaultSequencePreset } = await import("../../src/tools/sequence.js");
    expect(findDefaultSequencePreset()).toBeNull();
    expect(findDefaultSequencePreset()).toBeNull();
  });
});
