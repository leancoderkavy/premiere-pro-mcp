import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { readBoundedRegularFile } from "../security/file-safety.js";

/**
 * Finds an audio-only Adobe Media Encoder system preset on disk, so a sequence can be
 * exported as sound alone (no picture) for upload to a transcription service.
 *
 * AME ships presets under `<AME install>/MediaIO/systempresets/<vendor>_<format>/` where the
 * folder name is hex of the exporter four-character code. Audio-only exporters used here:
 * `57415645` "WAVE", `41414320` "AAC ", `4D503320` "MP3 ", `41494646` "AIFF". The folder id
 * is only a first filter: a preset counts only when its own XML says `<DoVideo>false</DoVideo>`
 * and `<DoAudio>true</DoAudio>` (the file may be gzip-compressed), and it does not write to a
 * "Same as Project" location.
 */

const MAX_PRESET_BYTES = 8 * 1024 * 1024;

/** Audio-only exporter folders, best first: WAV is lossless and always accepted; AAC and MP3 are smaller. */
const AUDIO_FORMAT_ORDER: Array<{ id: string; label: string }> = [
  { id: "57415645", label: "WAV" },
  { id: "41414320", label: "AAC" },
  { id: "4D503320", label: "MP3" },
  { id: "41494646", label: "AIFF" },
];

export interface AudioOnlyPreset {
  path: string;
  name: string;
  format: string;
  /** Install the preset came from, e.g. "Adobe Media Encoder 2026". */
  install: string;
}

export interface AudioPresetLookup {
  /** Override of the install roots to search (tests). Each is the folder that holds "MediaIO". */
  installRoots?: string[];
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Newest version first: "Adobe Media Encoder 2026" before "... 2025". */
function newestFirst(names: string[]): string[] {
  return [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

/** Folders that hold `MediaIO/systempresets`, Windows and macOS, Media Encoder before Premiere Pro. */
export function audioPresetSearchRoots(lookup: AudioPresetLookup = {}): Array<{ systemPresets: string; install: string }> {
  const platform = lookup.platform ?? process.platform;
  const env = lookup.env ?? process.env;
  const found: Array<{ systemPresets: string; install: string }> = [];
  const add = (appDir: string, install: string) => {
    const candidates = [path.join(appDir, "MediaIO", "systempresets")];
    if (platform === "darwin") {
      // macOS: resources sit in Contents of the bundle, which may be nested one level down.
      candidates.unshift(path.join(appDir, "Contents", "MediaIO", "systempresets"));
      for (const entry of subdirectories(appDir)) {
        if (/\.app$/i.test(entry)) candidates.push(path.join(appDir, entry, "Contents", "MediaIO", "systempresets"));
      }
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        found.push({ systemPresets: candidate, install });
        return;
      }
    }
  };
  if (lookup.installRoots) {
    for (const root of lookup.installRoots) add(root, path.basename(root));
    return found;
  }
  const bases: string[] = [];
  if (platform === "darwin") {
    bases.push("/Applications");
  } else {
    for (const key of ["ProgramFiles", "ProgramW6432"]) {
      const value = env[key];
      if (value && !bases.includes(path.join(value, "Adobe"))) bases.push(path.join(value, "Adobe"));
    }
    if (bases.length === 0) bases.push(path.join("C:\\Program Files", "Adobe"));
  }
  for (const prefix of ["Adobe Media Encoder", "Adobe Premiere Pro"]) {
    for (const base of bases) {
      for (const name of newestFirst(subdirectories(base).filter((n) => n.startsWith(prefix)))) add(path.join(base, name), name);
    }
  }
  return found;
}

/** True when the preset XML (plain or gzip) renders sound only. */
export function isAudioOnlyPresetXml(xml: string): boolean {
  return /<DoVideo>\s*false\s*<\/DoVideo>/i.test(xml) && /<DoAudio>\s*true\s*<\/DoAudio>/i.test(xml) && !/SameAsProject|Same\s+as\s+Project/i.test(xml);
}

function decodePreset(contents: Buffer): string {
  if (contents.length >= 2 && contents[0] === 0x1f && contents[1] === 0x8b) {
    try {
      return gunzipSync(contents, { maxOutputLength: MAX_PRESET_BYTES }).toString("utf8");
    } catch {
      // truncated or too large: fall through to a raw read, which will not match
    }
  }
  return contents.toString("utf8");
}

function presetIsAudioOnly(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    return isAudioOnlyPresetXml(decodePreset(readBoundedRegularFile(file, MAX_PRESET_BYTES)));
  } catch {
    return false;
  }
}

/**
 * The best audio-only system preset, or null when none exists. WAV first, then AAC, MP3, AIFF;
 * inside a format the name that sorts first among those mentioning "High Quality"/"256" wins,
 * otherwise alphabetical. Newest install first.
 */
export function findAudioOnlyPreset(lookup: AudioPresetLookup = {}): AudioOnlyPreset | null {
  for (const root of audioPresetSearchRoots(lookup)) {
    const folders = subdirectories(root.systemPresets);
    for (const format of AUDIO_FORMAT_ORDER) {
      const folder = folders.find((f) => f.toUpperCase().endsWith(`_${format.id}`));
      if (!folder) continue;
      let files: string[] = [];
      try {
        files = readdirSync(path.join(root.systemPresets, folder)).filter((n) => n.toLowerCase().endsWith(".epr"));
      } catch {
        continue;
      }
      files.sort((a, b) => {
        const rank = (n: string) => (/high quality|256/i.test(n) ? 0 : 1);
        return rank(a) - rank(b) || a.localeCompare(b);
      });
      for (const file of files) {
        const full = path.join(root.systemPresets, folder, file);
        if (presetIsAudioOnly(full)) return { path: full, name: file.replace(/\.epr$/i, ""), format: format.label, install: root.install };
      }
    }
  }
  return null;
}
