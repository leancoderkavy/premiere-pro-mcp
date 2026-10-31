import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getStockTitleTools, type StockTitleTemplate } from "../../src/tools/stock-titles.js";
const send = vi.mocked(sendCommand);
const ticks = 254016000000;
const catalog: StockTitleTemplate[] = [{ name: "Styled", category: "", path: "/scratch/Styled.mogrt", kind: "after_effects", textFields: [{ index: 0, label: "Headline", defaultText: "Default" }] }];
const tool = () => getStockTitleTools({ timeoutMs: 5000 }, () => catalog).add_title;
function collection(values: unknown[]) { return Object.assign({ numItems: values.length }, values); }
function host(options: {
    ignore?: boolean;
    missing?: boolean;
    unreadable?: boolean;
    throws?: boolean;
    noMgt?: boolean;
    malformed?: boolean;
    alterText?: boolean;
    duplicateColor?: boolean;
    animated?: boolean;
    resetFont?: boolean;
    nested?: boolean;
    multi?: boolean;
    runs?: boolean;
    locked?: boolean;
} = {}) {
    const state = { json: JSON.stringify(options.missing ? { textEditValue: "Default" } : { textEditValue: options.ignore ? "Brand" : "Default", fontName: "Original", fontSize: 72, opaque: { keep: true } }), color: [255, 0, 0, 0], position: [0.5, 0.5], imports: 0 };
    // Premiere 26.5.2 AE-authored title Source Text, as read live from a stock template.
    if (options.runs || options.locked)
        state.json = JSON.stringify({ capPropFontEdit: !options.locked, capPropFontFauxStyleEdit: true, capPropFontSizeEdit: !options.locked, capPropTextRunCount: 2, fontEditValue: ["BebasNeue-Regular", "BebasNeue-Bold"], fontFSBoldValue: [false, false], fontSizeEditValue: [40, 32], fontTextRunLength: [4, 3], textEditValue: "Default" });
    if (options.nested)
        state.json = JSON.stringify({ textEditValue: "Default", opaque: { fontName: "Nested", fontSize: 72 } });
    const text = { displayName: "Headline", isTimeVarying: () => Boolean(options.animated), getValue() { if (options.unreadable && state.json.includes('"fontSize":54'))
            throw Error("unreadable"); return options.malformed ? '{"textEditValue":"Default","fontName":' : state.json; }, setValue(value: string) { if (options.throws)
            throw Error("setter failed"); if (!options.ignore) {
            state.json = value;
            if (options.resetFont && value.includes('"fontSize":54'))
                state.json = state.json.replace('"fontName":"Metropolis"', '"fontName":"Reset"');
            if (options.alterText && value.includes('Metropolis'))
                state.json = value.replace(/"textEditValue":"[^"]*"/, '"textEditValue":"Changed"');
        } } };
    const color = { displayName: "Fill Color", isTimeVarying: () => Boolean(options.animated), getValue: () => 0, getColorValue: () => state.color, setColorValue: (a: number, r: number, g: number, b: number) => { if (!options.ignore)
            state.color = [a, r, g, b]; } };
    const point = { displayName: "Position", isTimeVarying: () => Boolean(options.animated), matchName: "ADBE Position", getValue: () => state.position, setValue: (v: number[]) => { if (!options.ignore)
            state.position = v; } };
    const clip = { name: "Title", nodeId: "title-1", start: { ticks: "0" }, end: { ticks: String(5 * ticks) }, getMGTComponent: () => options.noMgt ? null : ({ properties: collection([text, ...(options.missing ? [] : [color]), ...(options.duplicateColor ? [color] : [])]) }), components: collection([{ matchName: "AE.ADBE Motion", properties: collection([point]) }]) };
    send.mockImplementation(async (script) => {
        parse(getHelpersSource() + "\n" + script, { ecmaVersion: 3, allowReserved: "never" });
        const context = { app: { project: { activeSequence: { timebase: String(ticks / 25), videoTracks: collection([{ clips: collection([]) }, { clips: collection([]) }]), importMGT: () => { state.imports++; return clip; } } } } };
        return JSON.parse(String(runInNewContext(getHelpersSource() + "\n" + script, context)));
    });
    return state;
}
async function add(style: Record<string, unknown>) { return await tool().handler({ text: "Brand", template: "Styled", ...style } as any) as any; }
beforeEach(() => { vi.clearAllMocks(); catalog[0].kind = "after_effects"; catalog[0].textFields = [{ index: 0, label: "Headline", defaultText: "Default" }]; });
describe("title style fields", () => {
    it("declares each optional style field and its contract", () => { expect(Object.keys(tool().parameters.properties)).toEqual(expect.arrayContaining(["font_family", "font_size", "fill_color", "align", "position"])); });
    it("writes font, size, fill and normalized position with per-field stored readback", async () => { const s = host(); const r = await add({ font_family: "Metropolis", font_size: 54, fill_color: "#00325A", position: { x: 0.5, y: 0.3325 } }); expect(r.data.styleChecks).toHaveLength(4); expect(r.data.styleChecks).toEqual(expect.arrayContaining([expect.objectContaining({ field: "font_family", status: "verified" }), expect.objectContaining({ field: "font_size", status: "verified" }), expect.objectContaining({ field: "fill_color", status: "verified" }), expect.objectContaining({ field: "position", status: "verified" })])); expect(JSON.parse(s.json)).toEqual({ textEditValue: "Brand", fontName: "Metropolis", fontSize: 54, opaque: { keep: true } }); expect(s.color).toEqual([255, 0, 50, 90]); expect(s.position).toEqual([0.5, 0.3325]); expect(r.data.outcome).toBe("verified"); });
    it("keeps ignored style writes unverified even when text and duration already match", async () => { host({ ignore: true }); const r = await add({ font_family: "Metropolis", font_size: 54, fill_color: "#FDC82F", position: { x: 0.3, y: 0.6 } }); expect(r.data.styleChecks).toHaveLength(4); expect(r.data.styleChecks.every((x: any) => x.status === "committed_unverified")).toBe(true); expect(r.data.outcome).not.toBe("verified"); });
    it("reports unavailable properties individually without inventing JSON keys", async () => { const s = host({ missing: true }); const r = await add({ font_family: "Metropolis", font_size: 54, fill_color: "#00325A" }); expect(r.data.styleChecks).toHaveLength(3); expect(r.data.styleChecks.every((x: any) => x.status === "committed_unverified")).toBe(true); expect(JSON.parse(s.json)).toEqual({ textEditValue: "Brand" }); });
    it("refuses alignment before any import rather than guessing its enum", async () => { host(); const r = await add({ align: "center", font_size: 54 }); expect(r.success).toBe(false); expect(r.data.outcome).toBe("not_applied"); expect(r.data.styleChecks).toHaveLength(2); expect(send).not.toHaveBeenCalled(); });
    it("refuses live font/fill styling on Premiere-authored titles before baking or import", async () => { host(); catalog[0].kind = "premiere"; const r = await add({ font_family: "Metropolis", fill_color: "#00325A" }); expect(r.success).toBe(false); expect(r.data.code).toBe("TITLE_STYLE_UNSUPPORTED"); expect(send).not.toHaveBeenCalled(); });
    it.each([{ font_family: "" }, { font_family: 23 }, { font_family: "a".repeat(257) }, { font_size: NaN }, { font_size: 0 }, { font_size: Infinity }, { fill_color: "red" }, { fill_color: "#12345678" }, { align: "justify" }, { position: { x: 1080, y: 400 } }, { position: { x: 0.5, y: NaN } }, { position: [0.5, 0.5] }, { position: null }])("rejects invalid fields before dispatch: %j", async (style) => { host(); const r = await add(style); expect(r.success).toBe(false); expect(send).not.toHaveBeenCalled(); });
    it("preserves quote, slash and newline fonts through strict ES3 generation", async () => { const s = host(); const name = 'Zen "Dots" \\ line\nNext'; const r = await add({ font_family: name }); expect(r.data.styleChecks[0].status).toBe("verified"); expect(JSON.parse(s.json).fontName).toBe(name); });
    it("reports unreadable style readback after a setter without claiming verification", async () => {
        host({ unreadable: true });
        const r = await add({ font_size: 54 });
        expect(r.data.styleChecks[0].status).toBe("committed_unverified");
        expect(r.data.styleChecks[0].actual).toBeNull();
        expect(r.data.outcome).toBe("committed_unverified");
    });
    it("represents each requested line even when only the first text control is exposed", async () => {
        host();
        catalog[0].textFields.push({ index: 1, label: "Subtitle", defaultText: "Other" });
        const r = await tool().handler({ lines: ["Brand", "Subtitle"], template: "Styled", font_size: 54 }) as any;
        expect(r.data.styleChecks).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "font_size", index: 0, status: "verified" }),
            expect.objectContaining({ field: "font_size", index: 1, status: "committed_unverified" }),
        ]));
        expect(r.data.outcome).toBe("committed_unverified");
    });
    it("writes every Premiere 26 text run and reads each run back", async () => { const s = host({ runs: true }); const r = await add({ font_family: "Metropolis-Regular", font_size: 54 }); expect(r.data.styleChecks).toEqual([expect.objectContaining({ field: "font_family", actual: "Metropolis-Regular", status: "verified" }), expect.objectContaining({ field: "font_size", actual: 54, status: "verified" })]); const stored = JSON.parse(s.json); expect(stored.fontEditValue).toEqual(["Metropolis-Regular", "Metropolis-Regular"]); expect(stored.fontSizeEditValue).toEqual([54, 54]); expect(stored.fontTextRunLength).toEqual([4, 3]); expect(stored.fontFSBoldValue).toEqual([false, false]); expect(stored.textEditValue).toBe("Brand"); });
    it("refuses font and size writes when the template locks them", async () => { const s = host({ locked: true }); const r = await add({ font_family: "Metropolis-Regular", font_size: 54 }); expect(r.data.styleChecks.every((c: any) => c.status === "committed_unverified" && /does not allow/.test(c.reason))).toBe(true); const stored = JSON.parse(s.json); expect(stored.fontEditValue).toEqual(["BebasNeue-Regular", "BebasNeue-Bold"]); expect(stored.fontSizeEditValue).toEqual([40, 32]); });
    it("handles a throwing font setter as unverified", async () => { host({ throws: true }); const r = await add({ font_size: 48 }); expect(r.data.styleChecks[0].status).toBe("committed_unverified"); });
    it("does not style malformed Source Text JSON", async () => { const s = host({ malformed: true }); const before = s.json; const r = await add({ font_size: 48 }); expect(r.data.styleChecks[0].status).toBe("committed_unverified"); expect(JSON.parse(before).fontSize).toBe(72); expect(s.json).not.toContain('"fontSize":48'); });
    it("does not select an ambiguous fill control", async () => { const s = host({ duplicateColor: true }); const r = await add({ fill_color: "#00325A" }); expect(r.data.styleChecks[0].status).toBe("committed_unverified"); expect(s.color).toEqual([255, 0, 0, 0]); });
    it("refreshes text readback after a style write", async () => { host({ alterText: true }); const r = await add({ font_family: "Metropolis" }); expect(r.data.textVerification).toBe("mismatch"); expect(r.data.outcome).not.toBe("verified"); });
    it("does not overwrite animated controls", async () => { const s = host({ animated: true }); const r = await add({ font_family: "Metropolis", font_size: 54, fill_color: "#00325A", position: { x: 0.3, y: 0.6 } }); expect(r.data.styleChecks.every((c: any) => c.status === "committed_unverified")).toBe(true); expect(JSON.parse(s.json).fontName).toBe("Original"); expect(s.color).toEqual([255, 0, 0, 0]); expect(s.position).toEqual([0.5, 0.5]); });
    it("does not rewrite nested keys that only resemble the supported root keys", async () => { const s = host({ nested: true }); const r = await add({ font_family: "Metropolis", font_size: 54 }); expect(r.data.styleChecks.every((c: any) => c.status === "committed_unverified")).toBe(true); expect(JSON.parse(s.json).opaque).toEqual({ fontName: "Nested", fontSize: 72 }); });
    it("compares font names after the last style write, including host collateral changes", async () => { host({ resetFont: true }); const r = await add({ font_family: "Metropolis", font_size: 54 }); expect(r.data.styleChecks.find((c: any) => c.field === "font_family").status).toBe("committed_unverified"); });
    it("reports no MGT component without losing position verification", async () => { host({ noMgt: true }); const r = await add({ font_size: 54, position: { x: 0.3, y: 0.6 } }); expect(r.data.styleChecks.find((c: any) => c.field === "font_size").status).toBe("committed_unverified"); expect(r.data.styleChecks.find((c: any) => c.field === "position").status).toBe("verified"); });
});
