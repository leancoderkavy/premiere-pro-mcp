import { readBoundedRegularFile } from "../security/file-safety.js";
import { createHash } from "node:crypto";

import { isAbsolute } from "node:path";
import { ticks, rate, type RationalRate } from "../ai/exact-time.js";
import { inspectFcpxml, parseCmx3600Edl } from "../tools/interchange-analysis.js";
import { boundJsonTree, boundedText, MAX_INTERCHANGE_BYTES, onlyKeys, record } from "./bounded-file.js";
import { inspectOtio } from "./otio.js";

export type InterchangeFormat = "otio" | "fcp7xml" | "fcpxml" | "edl" | "aaf" | "omf";
export const INTERCHANGE_FEATURES = ["linear_timing", "nests", "effects", "links", "retiming", "captions", "metadata", "transitions", "gain_automation", "channel_mapping"] as const;
type Feature = typeof INTERCHANGE_FEATURES[number];

/** Minimal bounded XML well-formedness gate; never resolves DTDs or entities. */
function validateXmlStructure(contents: string) {
  const stack: string[] = [];
  let root: string | null = null, position = 0, nodes = 0, doctypes = 0;
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?(?:[^?]|\?(?!>))*\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  function entities(value: string) {
    if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(value)) throw new Error("XML contains unsupported/unresolved entity references");
    for (const match of value.matchAll(/&#(x[0-9a-f]+|\d+);/gi)) {
      const code = match[1].toLowerCase().startsWith("x") ? Number.parseInt(match[1].slice(1), 16) : Number(match[1]);
      if (![9, 10, 13].includes(code) && !(code >= 32 && code <= 0xd7ff) && !(code >= 0xe000 && code <= 0xfffd) && !(code >= 0x10000 && code <= 0x10ffff)) throw new Error("XML numeric entity names an invalid character");
    }
  }
  function text(value: string) {
    if (value.includes("<") || value.includes("]]>") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (!stack.length && value.trim())) throw new Error("Malformed XML text or multiple root elements");
    entities(value);
  }
  for (const match of contents.matchAll(tokens)) {
    text(contents.slice(position, match.index)); position = match.index! + match[0].length;
    const token = match[0];
    if (token.startsWith("<!--")) { if (token.slice(4, -3).includes("--")) throw new Error("Malformed XML comment"); continue; }
    if (token.startsWith("<?")) { if (/^<\?xml\s/i.test(token) && root) throw new Error("XML declaration must precede root"); continue; }
    if (token.startsWith("<![CDATA[")) { if (!stack.length) throw new Error("CDATA outside XML root"); continue; }
    if (/^<!DOCTYPE\s/i.test(token)) {
      if (root || ++doctypes > 1 || /[\[\]]/.test(token)) throw new Error("XML internal/duplicate DTD/entity declarations are unsupported");
      continue;
    }
    if (token.startsWith("<!")) throw new Error("Unsupported XML declaration");
    const closing = /^<\/([A-Za-z_][\w:.-]*)\s*>$/.exec(token);
    if (closing) { if (stack.pop() !== closing[1]) throw new Error("XML close tag mismatches open tag"); continue; }
    const opening = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);
    if (!opening) throw new Error("Malformed XML tag");
    if (++nodes > 20_000 || stack.length >= 64) throw new Error("XML exceeds 20,000 elements or 64 nesting levels");
    const attributeBody = opening[2], attributes = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g;
    let remainder = attributeBody, attributeCount = 0;
    const seenAttributes = new Set<string>();
    for (const attribute of attributeBody.matchAll(attributes)) {
      if (++attributeCount > 256 || seenAttributes.has(attribute[1])) throw new Error("XML attributes exceed bounds or are duplicated");
      seenAttributes.add(attribute[1]);
      remainder = remainder.replace(attribute[0], "");
      if (attribute[0].includes("<")) throw new Error("XML attribute contains a literal less-than character");
      entities(attribute[0]);
    }
    if (remainder.trim()) throw new Error("Malformed XML attributes");
    if (!stack.length) { if (root) throw new Error("Multiple XML root elements"); root = opening[1]; }
    if (!opening[3]) stack.push(opening[1]);
  }
  text(contents.slice(position));
  if (!root || stack.length) throw new Error("XML root or closing tags are incomplete");
  return root.toLowerCase();
}

/** Inspect requested bytes only, not referenced media or arbitrary project packets. */
export function inspectInterchangeArtifact(path: unknown, expected?: InterchangeFormat) {
  const target = boundedText(path, "path", 4096, false);
  if (!isAbsolute(target)) throw new Error("path must be absolute");
  {
    const buffer = readBoundedRegularFile(target, MAX_INTERCHANGE_BYTES);
    if (buffer.length === 0) throw new Error("Artifact must be nonempty");
    if (buffer.length > MAX_INTERCHANGE_BYTES) throw new Error("Artifact grew beyond byte limit");
    let format: InterchangeFormat | null = null, structure: unknown = null;
    const decoded = buffer.toString("utf8"), text = decoded.replace(/^\uFEFF/, "");
    const xml = text.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/, "");
    if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      if (expected !== "aaf") throw new Error("Compound-binary artifact requires explicit aaf format; signature alone does not identify AAF semantics");
      format = "aaf";
      structure = { parsed: false, signature: "compound_binary", warning: "AAF composition, handles, automation and destination DAW acceptance require an AAF-aware reader or licensed destination gate" };
    } else if (expected === "omf") {
      format = "omf";
      structure = { parsed: false, signature: "opaque_binary", warning: "OMF bytes exist but composition, media handles and destination acceptance are not inspected" };
    } else if (!Buffer.from(decoded, "utf8").equals(buffer) || /\0/.test(text)) throw new Error("Text interchange must contain valid UTF-8 without NUL");
    else if (/^\s*\{/.test(text)) { format = "otio"; structure = inspectOtio(text); }
    else if (/^<(?:xmeml|fcpxml)\b/i.test(xml) || /^<!DOCTYPE\b/i.test(xml)) {
      const root = validateXmlStructure(text);
      if (root !== "xmeml" && root !== "fcpxml") throw new Error("Unsupported actual XML root");
      format = root === "xmeml" ? "fcp7xml" : "fcpxml"; structure = inspectFcpxml(text);
    }
    else if (/^(?:TITLE\s*:|FCM\s*:|\s*\d{1,4}\s+\S+\s+\S+\s+[CDW]\b)/im.test(text)) {
      format = "edl"; structure = parseCmx3600Edl(text);
      if (!(structure as ReturnType<typeof parseCmx3600Edl>).events.length) throw new Error("EDL contains no supported event records");
    }
    if (!format) throw new Error("Artifact has no supported interchange root/signature");
    if (expected && format !== expected && !(expected === "fcpxml" && format === "fcp7xml")) throw new Error(`Artifact bytes identify ${format}, not requested ${expected}`);
    const parsed = format !== "aaf" && format !== "omf";
    return { schemaVersion: "premiere-mcp.interchange-artifact.v1", format, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), exists: true, parsed, structure, roundTripValidated: false, hostVerified: false, verificationBoundary: parsed ? "bounded_local_structure_inspection" : "local_file_bytes_only" };
  }
}

export function interchangeLossReport(format: InterchangeFormat, sourceFeatures: unknown = {}, artifact?: ReturnType<typeof inspectInterchangeArtifact>) {
  if (!["otio", "fcp7xml", "fcpxml", "edl", "aaf", "omf"].includes(format)) throw new Error("Unsupported interchange format");
  const source = record(sourceFeatures, "source_features");
  onlyKeys(source, INTERCHANGE_FEATURES, "source_features");
  for (const value of Object.values(source)) if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2_000) throw new Error("source_features values must be bounded counts from 0 to 2,000");
  const reports = INTERCHANGE_FEATURES.map(feature => {
    const sourceCount = source[feature] as number | undefined;
    let status: "inspected" | "preserved" | "approximated" | "dropped" | "unknown" = "unknown";
    let reason = "Source/output equivalence and destination import are not measured";
    if (sourceCount === 0) { status = "inspected"; reason = "Caller inventory declares no occurrences; this does not prove the inventory complete"; }
    else if (sourceCount !== undefined && format === "edl" && ["effects", "links", "captions", "metadata", "gain_automation", "channel_mapping"].includes(feature)) {
      status = "dropped"; reason = "The supported CMX event subset has no representation for this feature";
    } else if (sourceCount !== undefined && format === "edl" && ["nests", "transitions"].includes(feature)) {
      status = "approximated"; reason = feature === "nests" ? "CMX events can flatten nest timing but cannot preserve editable nest structure" : "CMX transition code/duration does not preserve effect parameters or rendered appearance";
    } else if (artifact?.parsed && feature === "linear_timing") {
      status = "inspected"; reason = "Bounded output structure was parsed; exact source timing equality needs a declared round-trip or snapshot comparison";
    } else if (format === "otio" && ["effects", "retiming", "metadata", "captions", "nests"].includes(feature)) {
      reason = "OTIO schema may represent this feature, but this bounded converter does not preserve its complete host semantics and refuses unsupported serialization";
    } else if ((format === "aaf" || format === "omf") && ["gain_automation", "channel_mapping", "links", "linear_timing"].includes(feature)) {
      reason = "Native exporter settings are requests; verify composition and audible alignment in the destination DAW";
    }
    return { feature, sourceCount: sourceCount ?? null, status, reason };
  });
  return { schemaVersion: "premiere-mcp.interchange-loss.v1", format: artifact?.format ?? format, features: reports, artifact: artifact ? { sha256: artifact.sha256, bytes: artifact.bytes, parsed: artifact.parsed } : null, destinationAcceptance: "not_run", hostVerified: false };
}

export function planAudioPostTurnover(input: unknown) {
  boundJsonTree(input);
  const options = record(input, "turnover");
  onlyKeys(options, ["format", "sequence_id", "range", "rate", "handle_frames", "sample_rate", "channel_mapping", "gain_automation", "media", "reference_picture"], "turnover");
  if (options.format !== "aaf" && options.format !== "omf") throw new Error("format must be aaf or omf");
  const sequenceId = boundedText(options.sequence_id, "sequence_id", 512, false), frameRate = rate(options.rate as RationalRate);
  const range = record(options.range, "range");
  onlyKeys(range, ["start_ticks", "end_ticks"], "range");
  const start = ticks(range.start_ticks, "start_ticks"), end = ticks(range.end_ticks, "end_ticks");
  if (start < 0n || end <= start) throw new Error("range must be positive with exclusive end_ticks greater than start_ticks");
  if (!Number.isSafeInteger(options.handle_frames) || (options.handle_frames as number) < 0 || (options.handle_frames as number) > 100_000) throw new Error("handle_frames must be from 0 to 100,000");
  if (![44100, 48000, 88200, 96000, 192000].includes(options.sample_rate as number)) throw new Error("sample_rate is unsupported");
  if (!["preserve_requested", "render_requested", "unsupported"].includes(options.gain_automation as string)) throw new Error("gain_automation must declare preserve_requested, render_requested or unsupported");
  if (!Array.isArray(options.channel_mapping) || options.channel_mapping.length > 256) throw new Error("channel_mapping exceeds 256 entries");
  const destinations = new Set<string>();
  const mapping = options.channel_mapping.map(value => {
    const item = record(value, "channel_mapping entry");
    onlyKeys(item, ["track_id", "source_channel", "destination_channel"], "channel_mapping entry");
    const trackId = boundedText(item.track_id, "track_id", 512, false);
    for (const key of ["source_channel", "destination_channel"]) if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 1 || (item[key] as number) > 128) throw new Error(`${key} must be from 1 to 128`);
    const destination = `${trackId}:${item.destination_channel}`;
    if (destinations.has(destination)) throw new Error("Duplicate channel destination within a track");
    destinations.add(destination);
    return { track_id: trackId, source_channel: item.source_channel, destination_channel: item.destination_channel, verification: "requested_not_measured" };
  });
  if (!Array.isArray(options.media) || options.media.length > 2_000) throw new Error("media must contain at most 2,000 manifest entries");
  const mediaIds = new Set<string>();
  const media = options.media.map(value => {
    const item = record(value, "media entry");
    onlyKeys(item, ["id", "file_name", "bytes", "sha256", "status"], "media entry");
    const id = boundedText(item.id, "media.id", 512, false);
    if (mediaIds.has(id)) throw new Error("Duplicate media ID");
    mediaIds.add(id);
    if (!Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0 || (typeof item.sha256 !== "string") || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error("Media manifest bytes/hash are invalid");
    if (!["available", "missing", "unverified"].includes(item.status as string)) throw new Error("Media manifest status is invalid");
    return { id, file_name: boundedText(item.file_name, "file_name", 512, false), bytes: item.bytes, sha256: item.sha256, status: item.status, evidence: "caller_manifest_not_file_readback" };
  });
  const reference = options.reference_picture == null ? null : boundedText(options.reference_picture, "reference_picture", 512, false);
  return { schemaVersion: "premiere-mcp.audio-post-turnover.v1", sequence_id: sequenceId, format: options.format, range: { start_ticks: start.toString(), end_ticks: end.toString(), endPolicy: "exclusive" }, rate: frameRate, handle_frames: options.handle_frames, sample_rate: options.sample_rate, channel_mapping: mapping, gain_automation: options.gain_automation, media, reference_picture: reference, readyForReview: media.every(item => item.status === "available") && options.gain_automation !== "unsupported", route: options.format === "aaf" ? "export_aaf_uxp or export_aaf (capability and reviewed options required)" : "export_omf (capability and reviewed options required)", verificationSteps: ["Compare requested range, handles, rate, channels and automation with native export options before dispatch", "Inspect output artifact bytes with inspect_interchange_artifact; opaque AAF/OMF bytes do not prove composition", "Verify reference picture conformance with verify_delivery_conformance", "Import in destination DAW and measure alignment/audible handles before marking accepted"], lossReport: interchangeLossReport(options.format, { channel_mapping: mapping.length, gain_automation: options.gain_automation === "unsupported" ? 1 : 0 }), mutatesProject: false, destinationAcceptance: "not_run", hostVerified: false };
}
