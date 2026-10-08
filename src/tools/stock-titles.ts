import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, join, relative, sep } from "node:path";
import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { extractMogrtText, MAX_MOGRT_TEXT_LENGTH, MogrtTextCheck, summarizeMogrtText } from "./mogrt-text.js";
import { MOGRT_DURATION_HELPER } from "./text.js";
import { bakePremiereTitle, BakeResult, readTemplateKind, readZipEntry, TemplateKind } from "./mogrt-bake.js";

export { readZipEntry };

/**
 * Plain-text titles built on the Essential Graphics templates that ship with
 * Premiere Pro. Premiere has no scripting API that creates a text layer from raw
 * text, but every install carries stock .mogrt files (Basic Title, Lower Thirds,
 * Credits, ...). A .mogrt is a zip whose definition.json lists the template's
 * text controls, so the catalog is read locally without contacting Premiere.
 */

export const DEFAULT_STOCK_TITLE = "Basic Title";
const MAX_MOGRT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEFINITION_BYTES = 4 * 1024 * 1024;
const MAX_STOCK_TEMPLATES = 500;
const MAX_SCAN_DEPTH = 3;
const MAX_TITLE_DURATION_SECONDS = 3600;
const MAX_TRACK_INDEX = 99;
/** definition.json clientControls type for a text field. */
const MOGRT_TEXT_CONTROL_TYPE = 6;

export interface StockTitleTextField {
  index: number;
  label: string;
  defaultText: string;
}

export interface StockTitleTemplate {
  name: string;
  category: string;
  path: string;
  /** "premiere": text is baked into a copy of the template; "after_effects": text is written live through the MGT component. */
  kind: TemplateKind;
  textFields: StockTitleTextField[];
}

function localized(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const table = (value as { strDB?: Array<{ localeString?: string; str?: string }> }).strDB;
  if (!Array.isArray(table) || table.length === 0) return "";
  const english = table.find((entry) => entry.localeString === "en_US");
  return String((english ?? table[0]).str ?? "");
}

/** Parse a .mogrt file's text controls from its definition.json. */
export function readMogrtTextFields(mogrtPath: string): StockTitleTextField[] {
  if (statSync(mogrtPath).size > MAX_MOGRT_FILE_BYTES) throw new Error("MOGRT file is too large to inspect");
  const definition = readZipEntry(readFileSync(mogrtPath), "definition.json");
  if (!definition) throw new Error("MOGRT has no definition.json");
  const parsed = JSON.parse(definition.toString("utf8").replace(/^\uFEFF/, "")) as { clientControls?: unknown[] };
  const controls = Array.isArray(parsed.clientControls) ? parsed.clientControls : [];
  const fields: StockTitleTextField[] = [];
  for (const control of controls) {
    if (!control || typeof control !== "object") continue;
    const record = control as Record<string, unknown>;
    if (Number(record.type) !== MOGRT_TEXT_CONTROL_TYPE) continue;
    fields.push({ index: fields.length, label: localized(record.uiName), defaultText: localized(record.value) });
  }
  return fields;
}

/** Folders that hold Premiere's stock Essential Graphics templates, newest install first. */
export function stockTitleRoots(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const roots: string[] = [];
  const override = env.PREMIERE_STOCK_MOGRT_DIRS;
  if (override) {
    // An explicit folder list replaces install detection.
    const explicit = override.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
    return explicit.filter((root, index) => explicit.indexOf(root) === index && existsSync(root));
  }

  const installParent = platform === "darwin"
    ? "/Applications"
    : platform === "win32"
      ? join(env.ProgramFiles ?? "C:\\Program Files", "Adobe")
      : null;
  if (installParent && existsSync(installParent)) {
    let installs: string[] = [];
    try {
      installs = readdirSync(installParent).filter((name) => /^Adobe Premiere Pro/i.test(name)).sort().reverse();
    } catch {
      installs = [];
    }
    for (const install of installs) {
      if (platform === "darwin") {
        let bundles: string[] = [];
        try {
          bundles = readdirSync(join(installParent, install)).filter((name) => /^Adobe Premiere Pro.*\.app$/i.test(name));
        } catch {
          bundles = [];
        }
        for (const bundle of bundles) roots.push(join(installParent, install, bundle, "Contents", "Essential Graphics"));
      } else {
        roots.push(join(installParent, install, "Essential Graphics"));
      }
    }
  }
  return roots.filter((root, index) => roots.indexOf(root) === index && existsSync(root));
}

function collectMogrts(root: string, dir: string, depth: number, out: string[]): void {
  if (depth > MAX_SCAN_DEPTH || out.length >= MAX_STOCK_TEMPLATES) return;
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of names) {
    if (out.length >= MAX_STOCK_TEMPLATES) return;
    const candidate = join(dir, name);
    let stats;
    try {
      stats = statSync(candidate);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectMogrts(root, candidate, depth + 1, out);
    else if (/\.mogrt$/i.test(name)) out.push(candidate);
  }
}

/** Catalog every stock template that has at least one text field. The first root wins on name clashes. */
export function listStockTitles(roots: string[] = stockTitleRoots()): { templates: StockTitleTemplate[]; skipped: Array<{ path: string; reason: string }> } {
  const templates: StockTitleTemplate[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const files: string[] = [];
    collectMogrts(root, root, 0, files);
    for (const file of files) {
      const name = basename(file).replace(/\.mogrt$/i, "");
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      try {
        const textFields = readMogrtTextFields(file);
        if (textFields.length === 0) continue;
        const folder = relative(root, dirname(file));
        templates.push({ name, category: folder.split(sep).join("/"), path: file, kind: readTemplateKind(file), textFields });
        seen.add(key);
      } catch (error) {
        skipped.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { templates, skipped };
}

/** Resolve a template by name ("Bold Title") or category/name ("Titles/Bold Title"), case-insensitively. */
export function findStockTitle(templates: StockTitleTemplate[], requested: string): StockTitleTemplate | undefined {
  const wanted = requested.trim().replace(/\.mogrt$/i, "").toLowerCase();
  return templates.find((template) => template.name.toLowerCase() === wanted)
    ?? templates.find((template) => `${template.category}/${template.name}`.toLowerCase() === wanted);
}

/**
 * ES3 helper: write text into the Nth text-bearing MGT property. Stock templates
 * can give several fields the same display name (Basic Lower Third has two
 * "TextLayer" controls), so fields are addressed by order, not by name.
 */
export const MOGRT_TEXT_AT_HELPER = `
    function __mogrtTextProps(comp) {
      var props = [];
      for (var i = 0; i < comp.properties.numItems; i++) {
        var candidate = comp.properties[i];
        var value = null;
        try { value = candidate.getValue(); } catch (readError) { continue; }
        if (typeof value === "string" && /"textEditValue"\\s*:/.test(value)) props.push(candidate);
      }
      return props;
    }
    function __mogrtWriteTextAt(props, out, ordinal, plain, encoded) {
      var prop = props[ordinal];
      if (!prop) { out.push({ index: ordinal, missing: true }); return; }
      var before = prop.getValue();
      var next = before.replace(/"textEditValue"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"/, function () { return '"textEditValue":' + encoded; });
      try { prop.setValue(next, true); } catch (setError) { out.push({ index: ordinal, displayName: prop.displayName, setError: String(setError) }); return; }
      try { out.push({ index: ordinal, displayName: prop.displayName, value: prop.getValue() }); }
      catch (readError) { out.push({ index: ordinal, displayName: prop.displayName, readbackError: String(readError) }); }
    }
`;

function finiteInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function getStockTitleTools(bridgeOptions: BridgeOptions, catalog: () => StockTitleTemplate[] = () => listStockTitles().templates) {
  return {
    list_stock_titles: {
      description:
        "List the Essential Graphics title templates that ship with the installed Premiere Pro (Basic Title, Lower Thirds, Credits, Social Media, and more), with each template's text fields in order and their default text. Reads the local .mogrt files only; does not contact Premiere. Use the names with add_title.",
      parameters: {
        type: "object" as const,
        properties: {
          category: {
            type: "string",
            description: "Optional category folder filter, for example Titles, Lower Thirds, Credits, or Social Media (case-insensitive).",
          },
        },
      },
      handler: async (args: { category?: string }) => {
        const { templates, skipped } = listStockTitles();
        const filter = args.category?.trim().toLowerCase();
        const matching = filter ? templates.filter((template) => template.category.toLowerCase() === filter) : templates;
        if (templates.length === 0) {
          return {
            success: false,
            error: "No stock Essential Graphics templates were found. Set PREMIERE_STOCK_MOGRT_DIRS to the folder that holds Premiere's .mogrt files, or use import_mogrt with a template path.",
          };
        }
        return {
          success: true,
          data: {
            count: matching.length,
            templates: matching.map(({ name, category, kind, textFields }) => ({ name, category, kind, textFields })),
            ...(skipped.length ? { skipped } : {}),
          },
        };
      },
    },

    add_title: {
      description:
        "Add an on-screen title from plain text using a stock Essential Graphics template that ships with Premiere (default: Basic Title). Pass text for one line, or lines to fill the template's text fields in order (for example a lower third's name and role). Premiere-built templates (kind 'premiere') get the text baked into a verified copy before import, because Premiere exposes no writable text for them (textVerification 'template_verified'; confirm the render with export_frame). The baked copy path is returned as templateFile and saved under the application support premiere-pro-mcp/titles folder (macOS: ~/Library/Application Support/premiere-pro-mcp/titles). The cache keeps the newest 50 baked copies by modification time; export or copy templates elsewhere if a project needs older copies retained. After Effects-built templates (kind 'after_effects') are imported and their text fields written by position and read back from Premiere (textVerification 'verified', 'mismatch', 'missing_property', or 'committed_unverified'). The graphic is trimmed to duration_seconds and its length read back. Use list_stock_titles to see templates, their kind, and how many lines each takes.",
      parameters: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Title text for the first text field. Specify exactly one of text or lines.",
          },
          lines: {
            type: "array",
            items: { type: "string" },
            description: "Text for each of the template's text fields in order (see list_stock_titles). Specify exactly one of text or lines.",
          },
          template: {
            type: "string",
            description: `Stock template name such as "Basic Title", "Bold Title", or "Basic Lower Third", or category/name such as "Titles/Bold Title" (default: ${DEFAULT_STOCK_TITLE}).`,
          },
          track_index: {
            type: "number",
            description: "Zero-based video track for the graphic (default: 1, the track above the main footage).",
          },
          start_seconds: {
            type: "number",
            description: "Timeline start in seconds (default: 0).",
          },
          duration_seconds: {
            type: "number",
            description: "How long the title stays on screen in seconds (default: 5).",
          },
        },
      },
      handler: async (args: {
        text?: string;
        lines?: string[];
        template?: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
      }) => {
        if ((args.text === undefined) === (args.lines === undefined)) {
          return { success: false, error: "add_title requires exactly one of text or lines." };
        }
        const lines = args.lines ?? [args.text];
        if (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== "string")) {
          return { success: false, error: "lines must be a non-empty array of strings." };
        }
        if (lines.some((line) => (line as string).length > MAX_MOGRT_TEXT_LENGTH)) {
          return { success: false, error: `Each title line must be at most ${MAX_MOGRT_TEXT_LENGTH} characters.` };
        }
        let trackIndex: number;
        let startSeconds: number;
        let durationSeconds: number;
        try {
          trackIndex = finiteInRange(args.track_index ?? 1, "track_index", 0, MAX_TRACK_INDEX);
          startSeconds = finiteInRange(args.start_seconds ?? 0, "start_seconds", 0, 24 * 3600);
          durationSeconds = finiteInRange(args.duration_seconds ?? 5, "duration_seconds", 0.04, MAX_TITLE_DURATION_SECONDS);
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
        if (!Number.isInteger(trackIndex)) return { success: false, error: "track_index must be an integer." };

        const requestedTemplate = args.template ?? DEFAULT_STOCK_TITLE;
        const templates = catalog();
        const template = findStockTitle(templates, requestedTemplate);
        if (!template) {
          return {
            success: false,
            error: `Stock title template not found: ${requestedTemplate}. Call list_stock_titles for available names.`,
          };
        }
        if (lines.length > template.textFields.length) {
          return {
            success: false,
            error: `${template.name} has ${template.textFields.length} text field(s) but ${lines.length} line(s) were given. No change was attempted.`,
          };
        }

        // Premiere-built templates expose no writable text to scripting, so their
        // text is baked into a copy of the template before import.
        let importPath = template.path;
        let baked: BakeResult | undefined;
        if (template.kind === "premiere") {
          try {
            baked = bakePremiereTitle(template.path, lines as string[]);
          } catch (error) {
            return {
              success: false,
              error: `Could not prepare ${template.name} with the requested text: ${error instanceof Error ? error.message : String(error)}. No change was made in Premiere.`,
            };
          }
          if (baked.checks.some((check) => check.actual !== check.expected)) {
            return {
              success: false,
              error: `The prepared copy of ${template.name} did not read back with the requested text. No change was made in Premiere.`,
            };
          }
          importPath = baked.path;
        }

        const writes = baked ? "" : (lines as string[]).map((line, index) => `
            __mogrtWriteTextAt(textProps, textReadback, ${index}, "${escapeForExtendScript(line)}", "${escapeForExtendScript(JSON.stringify(line))}");`).join("");

        const script = buildToolScript(`
          ${MOGRT_TEXT_AT_HELPER}
          ${MOGRT_DURATION_HELPER}
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var mogrtPath = "${escapeForExtendScript(importPath)}";
          var clip = seq.importMGT(mogrtPath, __secondsToTicks(${startSeconds}).toString(), ${trackIndex}, ${trackIndex});
          if (!clip) return __error("Premiere did not import the title template: " + mogrtPath);

          var textReadback = null;
          var textWriteError = null;
          var mgtComp = null;
          var bakedTemplate = ${baked ? "true" : "false"};
          if (!bakedTemplate) {
            try { mgtComp = clip.getMGTComponent ? clip.getMGTComponent() : null; } catch (mgtError) { mgtComp = null; }
          }
          if (bakedTemplate) {
            textWriteError = null;
          } else if (!mgtComp) {
            textWriteError = "Imported title exposes no MGT component; text was not written";
          } else {
            textReadback = [];
            var textProps = __mogrtTextProps(mgtComp);
            ${writes}
          }
          var durationCheck = __mogrtSetDuration(clip, ${trackIndex}, ${durationSeconds});
          var appliedStartSeconds = null;
          try {
            var appliedStartTicks = parseFloat(clip.start.ticks);
            if (isFinite(appliedStartTicks)) appliedStartSeconds = __ticksToSeconds(appliedStartTicks);
          } catch (startReadError) {}
          return __result({
            clipName: clip.name,
            nodeId: clip.nodeId ? String(clip.nodeId) : null,
            textReadback: textReadback,
            textWriteError: textWriteError,
            duration: durationCheck,
            appliedStartSeconds: appliedStartSeconds
          });
        `);

        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;
        const { textReadback, textWriteError, duration, appliedStartSeconds, ...data } = (result.data ?? {}) as Record<string, unknown>;
        // Premiere snaps the placed graphic to the sequence frame grid, so report
        // the start it stored rather than the one requested.
        const appliedStart = typeof appliedStartSeconds === "number" && Number.isFinite(appliedStartSeconds) ? appliedStartSeconds : null;
        const base = {
          ...data,
          template: template.name,
          category: template.category,
          trackIndex,
          startSeconds: appliedStart ?? startSeconds,
          requestedStartSeconds: startSeconds,
          appliedStartSeconds: appliedStart,
          durationSeconds,
          duration,
        };

        const warnings: string[] = [];
        let textVerification: string;
        let textChecks: Array<MogrtTextCheck | { displayName: string; expected: string; actual: string | null; status: string }> | undefined;
        if (baked) {
          textVerification = "template_verified";
          textChecks = baked.checks.map((check) => ({
            displayName: `${template.textFields[check.index]?.label || "Text"} #${check.index + 1}`,
            expected: check.expected,
            actual: check.actual,
            status: "template_verified",
          }));
        } else if (!Array.isArray(textReadback)) {
          textVerification = "committed_unverified";
          warnings.push(String(textWriteError ?? "Title text could not be written or read back"));
        } else {
          const liveChecks: MogrtTextCheck[] = (lines as string[]).map((expected, index) => {
            const entry = (textReadback as Array<Record<string, unknown>>).find((item) => item.index === index);
            const displayName = `${template.textFields[index]?.label || "Text"} #${index + 1}`;
            if (!entry || entry.missing === true) return { displayName, expected, actual: null, status: "missing_property" as const };
            if (entry.setError !== undefined || entry.readbackError !== undefined) {
              return { displayName, expected, actual: null, status: "committed_unverified" as const };
            }
            const actual = extractMogrtText(entry.value);
            return { displayName, expected, actual, status: actual === expected ? "verified" as const : "mismatch" as const };
          });
          textChecks = liveChecks;
          textVerification = summarizeMogrtText(liveChecks);
          if (textVerification !== "verified") warnings.push("One or more title lines did not read back as written; inspect textChecks.");
        }

        const durationStatus = (duration as { status?: string } | undefined)?.status ?? "committed_unverified";
        if (durationStatus !== "verified") {
          warnings.push(`Title duration was not verified (${durationStatus}); ${String((duration as { error?: string } | undefined)?.error ?? "check the clip's length on the timeline")}.`);
        }
        const textOk = textVerification === "verified" || textVerification === "template_verified";
        let outcome = textVerification;
        if (textOk) outcome = durationStatus === "verified" ? textVerification : "committed_unverified";
        return {
          ...result,
          data: {
            ...base,
            outcome,
            textVerification,
            ...(baked
              ? {
                  templateFile: baked.path,
                  note: "Premiere-built templates expose no text readback, so the text was verified in the imported template file. Use export_frame to confirm the rendered title.",
                }
              : {}),
            ...(textChecks ? { textChecks } : {}),
            ...(warnings.length ? { warnings } : {}),
          },
        };
      },
    },
  };
}
