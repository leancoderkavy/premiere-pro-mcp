import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeOptions } from "../bridge/file-bridge.js";

const MAX_INTERCHANGE_BYTES = 10 * 1024 * 1024;
const MAX_EVENTS = 2_000;
const MAX_ISSUES = 256;
const MAX_ASSETS = 512;

export type CmxFrameRate = 24 | 25 | 29.97 | 30 | 50 | 59.94 | 60;

export interface CmxEvent {
  eventNumber: number;
  reel: string;
  track: string;
  transition: "C" | "D" | "W";
  transitionDurationFrames: number | null;
  sourceIn: string;
  sourceOut: string;
  recordIn: string;
  recordOut: string;
}

export interface CmxEdl {
  title: string | null;
  frameCodeMode: string | null;
  events: CmxEvent[];
  unrecognizedEventLines: Array<{ line: number; text: string }>;
}

const EVENT_PATTERN = /^\s*(\d{1,4})\s+(\S+)\s+(\S+)\s+([CDW])(?:\s+(\d{1,3}))?\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})\s*$/i;

export function parseCmx3600Edl(contents: string): CmxEdl {
  const events: CmxEvent[] = [];
  const unrecognizedEventLines: CmxEdl["unrecognizedEventLines"] = [];
  let title: string | null = null;
  let frameCodeMode: string | null = null;
  for (const [index, sourceLine] of contents.split(/\r?\n/).entries()) {
    const line = sourceLine.trimEnd();
    if (/^TITLE\s*:/i.test(line)) { title = line.replace(/^TITLE\s*:\s*/i, "").trim() || null; continue; }
    if (/^FCM\s*:/i.test(line)) { frameCodeMode = line.replace(/^FCM\s*:\s*/i, "").trim() || null; continue; }
    if (!/^\s*\d/.test(line)) continue;
    const match = line.match(EVENT_PATTERN);
    if (!match) {
      if (unrecognizedEventLines.length < MAX_ISSUES) unrecognizedEventLines.push({ line: index + 1, text: line.slice(0, 500) });
      continue;
    }
    if (events.length >= MAX_EVENTS) throw new Error(`CMX 3600 EDL exceeds the ${MAX_EVENTS}-event limit`);
    events.push({
      eventNumber: Number(match[1]), reel: match[2], track: match[3], transition: match[4].toUpperCase() as CmxEvent["transition"],
      transitionDurationFrames: match[5] ? Number(match[5]) : null,
      sourceIn: match[6], sourceOut: match[7], recordIn: match[8], recordOut: match[9],
    });
  }
  return { title, frameCodeMode, events, unrecognizedEventLines };
}

function nominalRate(rate: CmxFrameRate): number { return rate === 29.97 ? 30 : rate === 59.94 ? 60 : rate; }

export function timecodeToFrames(timecode: string, frameRate: CmxFrameRate): number {
  const match = timecode.match(/^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/);
  if (!match) throw new Error(`Invalid timecode: ${timecode}`);
  const [, hoursText, minutesText, secondsText, separator, framesText] = match;
  const hours = Number(hoursText), minutes = Number(minutesText), seconds = Number(secondsText), frames = Number(framesText);
  const nominal = nominalRate(frameRate);
  if (minutes > 59 || seconds > 59 || frames >= nominal) throw new Error(`Invalid timecode fields: ${timecode}`);
  if (separator === ";") {
    if (frameRate !== 29.97 && frameRate !== 59.94) throw new Error(`Drop-frame separator is only supported at 29.97 or 59.94 fps: ${timecode}`);
    const droppedPerMinute = frameRate === 29.97 ? 2 : 4;
    if (seconds === 0 && minutes % 10 !== 0 && frames < droppedPerMinute) throw new Error(`Invalid dropped frame number: ${timecode}`);
    const totalMinutes = hours * 60 + minutes;
    return ((hours * 3600 + minutes * 60 + seconds) * nominal + frames) - droppedPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return (hours * 3600 + minutes * 60 + seconds) * nominal + frames;
}

export interface CmxValidation { valid: boolean; errors: string[]; warnings: string[]; totalRecordFrames: number | null }

export function validateCmx3600Edl(edl: CmxEdl, frameRate: CmxFrameRate): CmxValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (edl.events.length === 0) errors.push("No CMX 3600 event records were found");
  if (edl.unrecognizedEventLines.length) warnings.push(`${edl.unrecognizedEventLines.length} numeric line(s) did not match the supported CMX 3600 event grammar`);
  const seen = new Set<number>();
  let previousRecordOut: number | null = null;
  let firstRecordIn: number | null = null;
  let finalRecordOut: number | null = null;
  for (const event of edl.events) {
    if (seen.has(event.eventNumber)) errors.push(`Event ${event.eventNumber} is duplicated`);
    seen.add(event.eventNumber);
    try {
      const sourceIn = timecodeToFrames(event.sourceIn, frameRate), sourceOut = timecodeToFrames(event.sourceOut, frameRate);
      const recordIn = timecodeToFrames(event.recordIn, frameRate), recordOut = timecodeToFrames(event.recordOut, frameRate);
      if (sourceOut <= sourceIn) errors.push(`Event ${event.eventNumber} has a non-positive source duration`);
      if (recordOut <= recordIn) errors.push(`Event ${event.eventNumber} has a non-positive record duration`);
      if (previousRecordOut !== null && recordIn < previousRecordOut) errors.push(`Event ${event.eventNumber} overlaps the previous record interval`);
      if (previousRecordOut !== null && recordIn > previousRecordOut) warnings.push(`Event ${event.eventNumber} begins after a record gap of ${recordIn - previousRecordOut} frames`);
      previousRecordOut = recordOut;
      firstRecordIn ??= recordIn;
      finalRecordOut = recordOut;
    } catch (error) { errors.push(`Event ${event.eventNumber}: ${(error as Error).message}`); }
  }
  return { valid: errors.length === 0, errors: errors.slice(0, MAX_ISSUES), warnings: warnings.slice(0, MAX_ISSUES), totalRecordFrames: firstRecordIn !== null && finalRecordOut !== null ? finalRecordOut - firstRecordIn : null };
}

function eventFingerprint(event: CmxEvent): string { return JSON.stringify({ reel: event.reel, track: event.track, transition: event.transition, transitionDurationFrames: event.transitionDurationFrames, sourceIn: event.sourceIn, sourceOut: event.sourceOut, recordIn: event.recordIn, recordOut: event.recordOut }); }

export function compareCmx3600Edls(before: CmxEdl, after: CmxEdl) {
  const beforeByEvent = new Map(before.events.map(event => [event.eventNumber, event]));
  const afterByEvent = new Map(after.events.map(event => [event.eventNumber, event]));
  const changes: Array<{ eventNumber: number; type: "added" | "removed" | "changed" }> = [];
  for (const [eventNumber, event] of beforeByEvent) {
    const candidate = afterByEvent.get(eventNumber);
    if (!candidate) changes.push({ eventNumber, type: "removed" });
    else if (eventFingerprint(event) !== eventFingerprint(candidate)) changes.push({ eventNumber, type: "changed" });
  }
  for (const eventNumber of afterByEvent.keys()) if (!beforeByEvent.has(eventNumber)) changes.push({ eventNumber, type: "added" });
  return { beforeEventCount: before.events.length, afterEventCount: after.events.length, changes: changes.slice(0, MAX_ISSUES), truncated: changes.length > MAX_ISSUES };
}

export interface FcpxmlAsset { id: string | null; name: string | null; source: string | null }

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = match[3];
  return result;
}

export function inspectFcpxml(contents: string) {
  const root = contents.match(/<fcpxml\b([^>]*)>/i);
  const assets: FcpxmlAsset[] = [];
  for (const match of contents.matchAll(/<(?:asset(?![-\w])|media-rep(?![-\w]))\b([^>]*)\/?>(?:<\/[^>]+>)?/gi)) {
    if (assets.length >= MAX_ASSETS) break;
    const attrs = attributes(match[1]);
    if (attrs.src || match[0].toLowerCase().startsWith("<asset")) assets.push({ id: attrs.id ?? null, name: attrs.name ?? null, source: attrs.src ?? null });
  }
  const clips = [...contents.matchAll(/<(?:asset-clip|ref-clip|video|audio)\b/gi)].length;
  const sequences = [...contents.matchAll(/<sequence\b/gi)].length;
  return {
    format: "FCPXML", version: root ? attributes(root[1]).version ?? null : null, sequenceCount: sequences, clipElementCount: clips,
    assetCount: assets.length, assets, assetsTruncated: assets.length === MAX_ASSETS,
    warnings: [
      ...(root ? [] : ["No <fcpxml> root element was found"]),
      ...( /<!DOCTYPE/i.test(contents) ? ["DOCTYPE is present; this tool inspects text only and never resolves entities"] : []),
    ],
  };
}

function readInterchangeFile(value: unknown, extensions: readonly string[]): { path: string; contents: string } {
  if (typeof value !== "string" || !value.trim()) throw new Error("path must be a non-empty string");
  const path = resolve(value);
  if (!extensions.some(extension => path.toLowerCase().endsWith(extension))) throw new Error(`path must have one of: ${extensions.join(", ")}`);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Interchange file does not exist: ${path}`);
  if (statSync(path).size > MAX_INTERCHANGE_BYTES) throw new Error(`Interchange file exceeds the ${MAX_INTERCHANGE_BYTES}-byte limit`);
  return { path, contents: readFileSync(path, "utf8") };
}

function fileUrlPath(value: string | null): string | null {
  if (!value || !/^file:\/\//i.test(value)) return null;
  try { return fileURLToPath(value); }
  catch { return null; }
}

function insideRoot(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function parseAllowedRoots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new Error("allowed_roots must contain 1 through 16 absolute directories");
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !isAbsolute(entry)) throw new Error(`allowed_roots[${index}] must be an absolute directory`);
    const root = resolve(entry);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`allowed_roots[${index}] is not an existing directory`);
    return root;
  });
}

export function getInterchangeAnalysisTools(_bridgeOptions: BridgeOptions) {
  return {
    inspect_cmx3600_edl: {
      description: "Parse a local CMX 3600 EDL into bounded event, reel, track, transition, and timecode facts without importing it into Premiere.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Existing local .edl file" } }, required: ["path"] },
      handler: async (args: { path?: string }) => {
        try { const file = readInterchangeFile(args.path, [".edl"]); const edl = parseCmx3600Edl(file.contents); return { success: true, data: { path: file.path, ...edl, eventCount: edl.events.length } }; }
        catch (error) { return { success: false, error: (error as Error).message }; }
      },
    },
    validate_cmx3600_edl: {
      description: "Validate a local CMX 3600 EDL's supported event grammar, timecodes, durations, duplicate event IDs, record overlaps, and record gaps before user-assisted Premiere interchange.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Existing local .edl file" }, frame_rate: { type: "number", description: "CMX timecode rate: 24, 25, 29.97, 30, 50, 59.94, or 60 (default: 24)" } }, required: ["path"] },
      handler: async (args: { path?: string; frame_rate?: CmxFrameRate }) => {
        const rate = args.frame_rate ?? 24;
        if (![24, 25, 29.97, 30, 50, 59.94, 60].includes(rate)) return { success: false, error: "frame_rate must be 24, 25, 29.97, 30, 50, 59.94, or 60" };
        try { const file = readInterchangeFile(args.path, [".edl"]); const edl = parseCmx3600Edl(file.contents); return { success: true, data: { path: file.path, frameRate: rate, ...validateCmx3600Edl(edl, rate) } }; }
        catch (error) { return { success: false, error: (error as Error).message }; }
      },
    },
    compare_cmx3600_edls: {
      description: "Compare two local CMX 3600 EDLs by event number and report bounded added, removed, and changed editorial events. Read-only; it does not alter either interchange file or Premiere.",
      parameters: { type: "object", properties: { before_path: { type: "string", description: "Existing baseline .edl file" }, after_path: { type: "string", description: "Existing revised .edl file" } }, required: ["before_path", "after_path"] },
      handler: async (args: { before_path?: string; after_path?: string }) => {
        try {
          const before = readInterchangeFile(args.before_path, [".edl"]), after = readInterchangeFile(args.after_path, [".edl"]);
          return { success: true, data: { beforePath: before.path, afterPath: after.path, ...compareCmx3600Edls(parseCmx3600Edl(before.contents), parseCmx3600Edl(after.contents)) } };
        } catch (error) { return { success: false, error: (error as Error).message }; }
      },
    },
    inspect_fcpxml_interchange: {
      description: "Inspect a local FCPXML document's root version, sequence/clip counts, bounded asset declarations, and text-only parser warnings before deliberate Premiere import.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Existing local .fcpxml or .xml file" } }, required: ["path"] },
      handler: async (args: { path?: string }) => {
        try { const file = readInterchangeFile(args.path, [".fcpxml", ".xml"]); return { success: true, data: { path: file.path, ...inspectFcpxml(file.contents) } }; }
        catch (error) { return { success: false, error: (error as Error).message }; }
      },
    },
    verify_fcpxml_media_references: {
      description: "Verify FCPXML file:// media references only inside caller-approved existing roots. References outside those roots are never statted or exposed as local paths.",
      parameters: { type: "object", properties: { path: { type: "string", description: "Existing local .fcpxml or .xml file" }, allowed_roots: { type: "array", items: { type: "string" }, description: "One to sixteen existing absolute roots that may be inspected" } }, required: ["path", "allowed_roots"] },
      handler: async (args: { path?: string; allowed_roots?: unknown }) => {
        try {
          const file = readInterchangeFile(args.path, [".fcpxml", ".xml"]), roots = parseAllowedRoots(args.allowed_roots), document = inspectFcpxml(file.contents);
          const references = document.assets.map(asset => {
            const localPath = fileUrlPath(asset.source);
            if (!localPath) return { assetId: asset.id, name: asset.name, status: asset.source ? "non_file_url" : "missing_source" };
            const resolved = resolve(localPath);
            if (!roots.some(root => insideRoot(resolved, root))) return { assetId: asset.id, name: asset.name, status: "outside_allowed_roots" };
            return { assetId: asset.id, name: asset.name, status: existsSync(resolved) && statSync(resolved).isFile() ? "available" : "missing", path: resolved };
          });
          return { success: true, data: { path: file.path, allowedRoots: roots, checkedReferenceCount: references.length, references } };
        } catch (error) { return { success: false, error: (error as Error).message }; }
      },
    },
  };
}
