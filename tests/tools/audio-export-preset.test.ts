import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audioPresetSearchRoots, findAudioOnlyPreset, isAudioOnlyPresetXml } from "../../src/tools/audio-export-preset.js";

const xml = (video: boolean, audio: boolean, extra = "") => `<?xml version="1.0"?><PremiereData><DoVideo>${video}</DoVideo><DoAudio>${audio}</DoAudio>${extra}</PremiereData>`;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "audio-preset-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function preset(install: string, folder: string, name: string, body: string | Buffer, layout: "win" | "mac" = "win") {
  const dir = join(root, install, ...(layout === "mac" ? ["Contents"] : []), "MediaIO", "systempresets", folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.epr`), body);
  return join(dir, `${name}.epr`);
}

describe("isAudioOnlyPresetXml", () => {
  it("needs DoVideo false, DoAudio true and no Same as Project", () => {
    expect(isAudioOnlyPresetXml(xml(false, true))).toBe(true);
    expect(isAudioOnlyPresetXml(xml(true, true))).toBe(false);
    expect(isAudioOnlyPresetXml(xml(false, false))).toBe(false);
    expect(isAudioOnlyPresetXml(xml(false, true, "<Path>SameAsProject</Path>"))).toBe(false);
  });
});

describe("findAudioOnlyPreset", () => {
  it("picks WAV over AAC and MP3, reading the preset contents, and reports the install", () => {
    preset("Adobe Media Encoder 2026", "3F3F3F3F_4D503320", "MP3 192kbps High Quality", xml(false, true));
    preset("Adobe Media Encoder 2026", "4E49434B_41414320", "Stereo AAC, 48kHz 256kbps", xml(false, true));
    const wav = preset("Adobe Media Encoder 2026", "3F3F3F3F_57415645", "Waveform Audio 48kHz 16-bit", xml(false, true));
    const found = findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")] });
    expect(found).toEqual({ path: wav, name: "Waveform Audio 48kHz 16-bit", format: "WAV", install: "Adobe Media Encoder 2026" });
  });

  it("skips a preset in an audio folder that still renders video, and reads gzip-compressed presets", () => {
    preset("Adobe Media Encoder 2026", "3F3F3F3F_57415645", "Fake WAV with picture", xml(true, true));
    const aac = preset("Adobe Media Encoder 2026", "4E49434B_41414320", "Stereo AAC, 44.1kHz 128kbps", gzipSync(Buffer.from(xml(false, true))));
    expect(findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")] })?.path).toBe(aac);
  });

  it("ignores H.264 and other folders even when their XML claims audio only, and returns null when nothing qualifies", () => {
    preset("Adobe Media Encoder 2026", "4E49434B_48323634", "00 - Match Source - High bitrate", xml(false, true));
    expect(findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")] })).toBeNull();
    expect(findAudioOnlyPreset({ installRoots: [join(root, "missing")] })).toBeNull();
  });

  it("finds presets in a macOS bundle layout (Contents/MediaIO) and not in it on Windows", () => {
    const mac = preset("Adobe Media Encoder 2026", "3F3F3F3F_57415645", "Waveform Audio 48kHz 16-bit", xml(false, true), "mac");
    expect(findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")], platform: "darwin" })?.path).toBe(mac);
    expect(findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")], platform: "win32" })).toBeNull();
  });

  it("macOS: also finds a nested .app bundle inside the install folder", () => {
    const dir = join(root, "Adobe Media Encoder 2026", "Adobe Media Encoder 2026.app", "Contents", "MediaIO", "systempresets", "3F3F3F3F_57415645");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "w.epr"), xml(false, true));
    expect(findAudioOnlyPreset({ installRoots: [join(root, "Adobe Media Encoder 2026")], platform: "darwin" })?.path).toBe(join(dir, "w.epr"));
  });
});

describe("audioPresetSearchRoots", () => {
  it("searches Program Files\\Adobe newest Media Encoder first, then Premiere Pro", () => {
    const base = join(root, "Adobe");
    for (const n of ["Adobe Media Encoder 2025", "Adobe Media Encoder 2026", "Adobe Premiere Pro 2026"]) mkdirSync(join(base, n, "MediaIO", "systempresets"), { recursive: true });
    const roots = audioPresetSearchRoots({ platform: "win32", env: { ProgramFiles: root } });
    expect(roots.map((r) => r.install)).toEqual(["Adobe Media Encoder 2026", "Adobe Media Encoder 2025", "Adobe Premiere Pro 2026"]);
  });
});
