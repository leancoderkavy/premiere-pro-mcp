import { statSync } from "node:fs";
import { readBoundedRegularFile } from "../security/file-safety.js";
import { readZipEntry, templateKind, readZipEntries, type TemplateKind } from "./mogrt-bake.js";

/** definition.json clientControls types seen in Essential Graphics files: 6 is text, 4 is colour. */
const TEXT_CONTROL_TYPE = 6;
const COLOR_CONTROL_TYPE = 4;
const MAX_MOGRT_BYTES = 64 * 1024 * 1024;

export interface MogrtControlInfo {
  /** definition.json "authorApp": "ppro" for Premiere, "aefx" for After Effects; null when absent. */
  author_app: string | null;
  kind: TemplateKind;
  text: string[];
  colour: string[];
  /** Controls of any other type, as "name (type N)". */
  other: string[];
}

function uiName(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const table = (value as { strDB?: Array<{ localeString?: string; str?: string }> }).strDB;
  if (!Array.isArray(table) || table.length === 0) return "";
  const english = table.find((entry) => entry.localeString === "en_US");
  return String((english ?? table[0]).str ?? "");
}

/**
 * Reads what a .mogrt exposes to scripts: its author app and the text and colour controls by their en_US
 * display name. Returns null when the archive or its definition cannot be read (validateMogrtArchive reports
 * those), so a caller only acts on what it could actually see.
 */
export function readMogrtControls(mogrtPath: string): MogrtControlInfo | null {
  try {
    if (statSync(mogrtPath).size > MAX_MOGRT_BYTES) return null;
    const archive = readBoundedRegularFile(mogrtPath, MAX_MOGRT_BYTES);
    const definition = readZipEntry(archive, "definition.json", 4 * 1024 * 1024);
    if (!definition) return null;
    const parsed = JSON.parse(definition.toString("utf8").replace(/^﻿/, "")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    let names: string[] = [];
    try {
      names = readZipEntries(archive).map((entry) => entry.name);
    } catch {
      names = [];
    }
    const info: MogrtControlInfo = {
      author_app: typeof parsed.authorApp === "string" && parsed.authorApp ? parsed.authorApp : null,
      kind: templateKind(names),
      text: [],
      colour: [],
      other: [],
    };
    const controls = Array.isArray(parsed.clientControls) ? parsed.clientControls : [];
    for (const control of controls) {
      if (!control || typeof control !== "object") continue;
      const record = control as Record<string, unknown>;
      const name = uiName(record.uiName);
      const type = Number(record.type);
      if (type === TEXT_CONTROL_TYPE) info.text.push(name);
      else if (type === COLOR_CONTROL_TYPE) info.colour.push(name);
      else info.other.push(`${name} (type ${Number.isFinite(type) ? type : "?"})`);
    }
    return info;
  } catch {
    return null;
  }
}

const list = (names: string[]) => (names.length ? names.map((n) => `"${n}"`).join(", ") : "none");

/** True for a template built in Premiere Pro (authorApp "ppro", or it carries project.prgraphic). */
export function isPremiereAuthored(info: MogrtControlInfo): boolean {
  return (info.author_app ?? "").toLowerCase() === "ppro" || info.kind === "premiere";
}

/**
 * Checks a caption template before anything is sent to Premiere. Returns the refusal message, or null when
 * the template can be used or could not be inspected (the host then reports any problem itself).
 * Refuses a Premiere-authored template (Premiere does not expose its text to scripts) and any text or
 * colour field name that is not a control of that type, listing the names that are.
 */
export function preflightCaptionTemplate(mogrtPath: string, fields: { textFields: string[]; colorField?: string }): string | null {
  const info = readMogrtControls(mogrtPath);
  if (!info) return null;
  if (isPremiereAuthored(info)) {
    return (
      "This MOGRT was built in Premiere Pro (definition.json authorApp \"ppro\"). Premiere does not expose a Premiere-built graphic's text to scripts, so captions cannot be written into it. " +
      "Use an After Effects-built MOGRT: make one with the chroma-ae MCP (ae_captions make_template, then ae_export_mogrt) or with this server's MOGRT authoring (preview_mogrt_recipe, then create_mogrt_recipe). " +
      "Nothing was sent to Premiere."
    );
  }
  const problems: string[] = [];
  for (const name of fields.textFields) {
    if (info.text.includes(name)) continue;
    const other = info.colour.includes(name) ? " (it is a colour control)" : info.other.some((o) => o.startsWith(`${name} (`)) ? " (it is not a text control)" : "";
    problems.push(`text field "${name}" is not a text control of the template${other}`);
  }
  if (fields.colorField !== undefined && !info.colour.includes(fields.colorField)) {
    const other = info.text.includes(fields.colorField) ? " (it is a text control)" : "";
    problems.push(`color_field "${fields.colorField}" is not a colour control of the template${other}`);
  }
  if (!problems.length) return null;
  return `${problems.join("; ")}. Text controls available: ${list(info.text)}. Colour controls available: ${list(info.colour)}. Nothing was sent to Premiere.`;
}
