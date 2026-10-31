import { escapeForExtendScript } from "../bridge/script-builder.js";
export interface TitleStyleArgs {
    font_family?: string;
    font_size?: number;
    fill_color?: string;
    align?: "left" | "center" | "right";
    position?: {
        x: number;
        y: number;
    };
}
export const TITLE_STYLE_FIELDS = ["font_family", "font_size", "fill_color", "align", "position"] as const;
export function validateTitleStyle(args: TitleStyleArgs): string | undefined {
    if (args.font_family !== undefined && (typeof args.font_family !== "string" || !args.font_family.trim() || args.font_family.length > 256 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(args.font_family)))
        return "font_family must be a non-empty font name of at most 256 characters";
    if (args.font_size !== undefined && (typeof args.font_size !== "number" || !Number.isFinite(args.font_size) || args.font_size <= 0 || args.font_size > 1000))
        return "font_size must be a finite number greater than 0 and at most 1000";
    if (args.fill_color !== undefined && (typeof args.fill_color !== "string" || !/^#[0-9a-f]{6}$/i.test(args.fill_color)))
        return "fill_color must be #RRGGBB";
    if (args.align !== undefined && !["left", "center", "right"].includes(args.align))
        return "align must be left, center, or right";
    const p = args.position;
    if (p !== undefined && (!p || Array.isArray(p) || typeof p !== "object" || [p.x, p.y].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)))
        return "position must contain normalized x and y numbers between 0 and 1";
    return undefined;
}
// Source Text JSON is returned to Node for comparison; no host JSON parser or eval.
// Premiere 26 AE-authored titles store one value per text run in
// fontEditValue / fontSizeEditValue arrays, gated by capPropFontEdit /
// capPropFontSizeEdit. Older fixtures use scalar fontName / fontSize keys.
const STYLE_HELPER = `
  function __titleFont(prop, field, index, encoded, out) {
    var entry = { field: field, index: index, value: null };
    out.push(entry);
    if (!prop) { entry.error = "No exposed Source Text control"; return; }
    try {
      if (typeof prop.isTimeVarying !== "function" || prop.isTimeVarying()) { entry.error = "Static Source Text control required; animation state is unreadable or animated"; return; }
      var raw = prop.getValue();
      if (typeof raw !== "string") { entry.error = "Source Text is not JSON text"; return; }
      var runPattern = field === "font_family" ? /"fontEditValue"\\s*:\\s*\\[(?:\\s*"(?:[^"\\\\]|\\\\.)*"\\s*,?)*\\s*\\]/g : /"fontSizeEditValue"\\s*:\\s*\\[(?:\\s*-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\\s*,?)*\\s*\\]/g;
      var scalarPattern = field === "font_family" ? /"fontName"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"/g : /"fontSize"\\s*:\\s*-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g;
      var runMatches = raw.match(runPattern), scalarMatches = raw.match(scalarPattern);
      var runs = !!runMatches;
      if (runs && scalarMatches) { entry.error = "Style key is missing or ambiguous"; return; }
      var pattern = runs ? runPattern : scalarPattern;
      var matches = runs ? runMatches : scalarMatches;
      if (!matches || matches.length !== 1) { entry.error = "Style key is missing or ambiguous"; return; }
      if (runs) {
        var capKey = field === "font_family" ? "capPropFontEdit" : "capPropFontSizeEdit";
        var capMatch = raw.match(new RegExp('"' + capKey + '"\\\\s*:\\\\s*(true|false)'));
        if (capMatch && capMatch[1] === "false") { entry.error = "Template does not allow " + (field === "font_family" ? "font" : "font size") + " editing"; return; }
      }
      var offset = raw.indexOf(matches[0]), level = 0, quoted = false, escaped = false;
      for (var ci = 0; ci < offset; ci++) {
        var ch = raw.charAt(ci);
        if (quoted) { if (escaped) escaped = false; else if (ch === "\\\\") escaped = true; else if (ch === '"') quoted = false; }
        else if (ch === '"') quoted = true;
        else if (ch === "{" || ch === "[") level++;
        else if (ch === "}" || ch === "]") level--;
      }
      if (level !== 1 || quoted) { entry.error = "Style key is not a top-level Source Text field"; return; }
      var key = runs ? (field === "font_family" ? "fontEditValue" : "fontSizeEditValue") : (field === "font_family" ? "fontName" : "fontSize");
      var replacement = encoded;
      if (runs) {
        // Keep the template's run count; every run gets the requested value.
        var body = matches[0].slice(matches[0].indexOf("[") + 1, matches[0].lastIndexOf("]"));
        var count = field === "font_family" ? (body.match(/"(?:[^"\\\\]|\\\\.)*"/g) || []).length : (body.match(/-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/g) || []).length;
        if (count < 1) { entry.error = "Style run array is empty"; return; }
        var values = [];
        for (var ri = 0; ri < count; ri++) values.push(encoded);
        replacement = "[" + values.join(",") + "]";
      }
      var next = raw.replace(pattern, function () { return '"' + key + '":' + replacement; });
      prop.setValue(next, true);
      entry.value = prop.getValue();
    } catch (styleError) { entry.error = String(styleError); }
  }
  function __titleColor(comp, rgba, out) {
    var entry = { field: "fill_color", index: null, value: null };
    out.push(entry);
    try {
      var found = null, count = 0;
      if (comp && comp.properties) for (var i = 0; i < comp.properties.numItems; i++) {
        var candidate = comp.properties[i];
        if (candidate.displayName === "Fill Color" && typeof candidate.getColorValue === "function" && typeof candidate.setColorValue === "function") { found = candidate; count++; }
      }
      if (count !== 1) { entry.error = "Requires exactly one exposed Fill Color control"; return; }
      if (typeof found.isTimeVarying !== "function" || found.isTimeVarying()) { entry.error = "Static Fill Color required; animation state is unreadable or animated"; return; }
      found.setColorValue(rgba[0], rgba[1], rgba[2], rgba[3], true);
      var observedColor = found.getColorValue();
      if (!observedColor || observedColor.length !== 4) { entry.error = "Fill Color readback is not ARGB"; return; }
      entry.value = [observedColor[0], observedColor[1], observedColor[2], observedColor[3]];
    } catch (colorError) { entry.error = String(colorError); }
  }
  function __titlePosition(clip, requested, out) {
    var entry = { field: "position", index: null, value: null };
    out.push(entry);
    try {
      var found = null, count = 0;
      if (clip.components) for (var i = 0; i < clip.components.numItems; i++) {
        var comp = clip.components[i];
        if (comp.matchName !== "AE.ADBE Motion") continue;
        for (var p = 0; p < comp.properties.numItems; p++) {
          if (__videoIntrinsicPropertyMatches(comp.properties[p], "Position")) { found = comp.properties[p]; count++; }
        }
      }
      if (count !== 1) { entry.error = "Requires exactly one intrinsic Motion Position"; return; }
      if (typeof found.isTimeVarying !== "function" || found.isTimeVarying()) { entry.error = "Static Motion Position required; animation state is unreadable or animated"; return; }
      var before = found.getValue();
      if (!before || before.length !== 2 || typeof before[0] !== "number" || typeof before[1] !== "number" || !isFinite(before[0]) || !isFinite(before[1])) { entry.error = "Motion Position does not expose a finite 2D point"; return; }
      found.setValue(requested, true);
      var observedPoint = found.getValue();
      if (!observedPoint || observedPoint.length !== 2) { entry.error = "Position readback is not a 2D point"; return; }
      entry.value = [observedPoint[0], observedPoint[1]];
    } catch (positionError) { entry.error = String(positionError); }
  }
`;
export function titleColor(value: string): number[] {
    return [255, parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}
export function buildTitleStyleScript(args: TitleStyleArgs, lines: number): string {
    const commands: string[] = [];
    for (let index = 0; index < lines; index++)
        for (const field of ["font_family", "font_size"] as const) {
            if (args[field] !== undefined)
                commands.push(`__titleFont(titleStyleProps[${index}], "${field}", ${index}, "${escapeForExtendScript(JSON.stringify(args[field]))}", titleStyleReadback);`);
        }
    if (args.fill_color !== undefined)
        commands.push(`__titleColor(mgtComp, [${titleColor(args.fill_color).join(",")}], titleStyleReadback);`);
    if (args.position !== undefined)
        commands.push(`__titlePosition(clip, [${args.position.x},${args.position.y}], titleStyleReadback);`);
    return commands.length ? `${STYLE_HELPER}\nvar titleStyleProps = mgtComp ? __mogrtTextProps(mgtComp) : [];\n${commands.join("\n")}\nfor (var sfi = 0; sfi < titleStyleReadback.length; sfi++) { var sr = titleStyleReadback[sfi]; if (sr.index !== null && !sr.error) { try { sr.value = titleStyleProps[sr.index].getValue(); } catch (finalStyleError) { sr.error = String(finalStyleError); } } }\nif (textReadback) for (var sri = 0; sri < textReadback.length; sri++) { try { if (titleStyleProps[sri]) textReadback[sri].value = titleStyleProps[sri].getValue(); } catch (styleTextError) { textReadback[sri].readbackError = String(styleTextError); } }` : "";
}
export function compareTitleStyle(args: TitleStyleArgs, lines: number, raw: unknown) {
    const entries = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
    return TITLE_STYLE_FIELDS.flatMap(field => {
        if (args[field] === undefined)
            return [];
        const indices = field === "font_family" || field === "font_size" ? Array.from({ length: lines }, (_, i) => i) : [null];
        return indices.map(index => {
            const entry = entries.find(e => e.field === field && e.index === index);
            let actual: unknown = entry?.value ?? null;
            let expected: unknown = args[field];
            if (field === "font_family" || field === "font_size") {
                try {
                    const parsed = JSON.parse(String(actual));
                    const runValues = parsed[field === "font_family" ? "fontEditValue" : "fontSizeEditValue"];
                    actual = Array.isArray(runValues)
                        ? (runValues.length > 0 && runValues.every(v => v === runValues[0]) ? runValues[0] : runValues)
                        : parsed[field === "font_family" ? "fontName" : "fontSize"] ?? null;
                }
                catch {
                    actual = null;
                }
            }
            else if (field === "fill_color")
                expected = titleColor(args.fill_color!);
            else if (field === "position")
                expected = [args.position!.x, args.position!.y];
            const matches = Array.isArray(expected)
                ? Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => typeof actual[i] === "number" && Number.isFinite(actual[i]) && actual[i] === v)
                : actual === expected;
            return { field, index, expected, actual, status: matches && entry && !entry.error ? "verified" : "committed_unverified", ...(entry?.error ? { reason: String(entry.error) } : !matches ? { reason: "Requested value did not read back exactly" } : {}) };
        });
    });
}
