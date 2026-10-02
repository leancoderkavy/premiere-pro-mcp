import { expect, it, vi } from "vitest";
vi.mock("../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: false, error: "stop" }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: false, error: "stop" }),
  getTempDir: vi.fn().mockReturnValue("/tmp/x"), cleanupTempDir: vi.fn(),
}));
vi.mock("../src/bridge/after-effects-bridge.js", async (orig) => ({ ...(await orig()), sendAfterEffectsCommand: vi.fn().mockResolvedValue({ success: false, error: "stop" }) }));
import { sendCommand, sendRawCommand } from "../src/bridge/file-bridge.js";
import { sendAfterEffectsCommand } from "../src/bridge/after-effects-bridge.js";
import * as acorn from "acorn";
import { getCompetitorGapTools } from "../src/tools/competitor-gaps.js";
import { createServer } from "../src/server.js";
import { getHelpersSource } from "../src/bridge/script-builder.js";
import { getAfterEffectsHelpersSource } from "../src/bridge/after-effects-script-builder.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

function sample(schema: any, depth = 0): any {
  if (!schema || depth > 5) return "x";
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (t === "number" || t === "integer") return typeof schema.minimum === "number" ? Math.max(schema.minimum, 1) : 1;
  if (t === "boolean") return true;
  if (t === "array") { const n = Math.max(schema.minItems ?? 1, 1); return Array.from({ length: n }, () => sample(schema.items ?? {}, depth + 1)); }
  if (t === "object" || schema.properties) {
    const out: any = {};
    for (const k of schema.required ?? []) out[k] = sample(schema.properties?.[k] ?? {}, depth + 1);
    return out;
  }
  if (schema.pattern && String(schema.pattern).includes("sha256")) return `sha256:${"a".repeat(64)}`;
  return "sample-value";
}

/**
 * Premiere runs generated scripts in ExtendScript (ECMAScript 3). A script that
 * does not parse fails as "EvalScript error." for every call; unit tests that
 * only inspect script text never notice. Live testing found four effect tools
 * (apply_effect, apply_audio_effect, remove_effect, remove_effect_by_name) that
 * had never parsed because `\\"` in a template literal lost its backslash.
 * This drives every registered tool with schema-shaped arguments and parses
 * each generated script with an ES3 parser.
 */
it("every generated ExtendScript parses as ECMAScript 3", async () => {
  vi.stubEnv("PREMIERE_MCP_CAPABILITIES", "inspect,edit,export,filesystem,unsafe-script");
  const server = createServer({ timeoutMs: 50 });
  const client = new Client({ name: "scan", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const tools = (await client.listTools()).tools;
  const report: string[] = [];
  let scanned = 0;
  for (const tool of tools) {
    vi.mocked(sendCommand).mockClear(); vi.mocked(sendRawCommand).mockClear(); vi.mocked(sendAfterEffectsCommand).mockClear();
    try { await client.callTool({ name: tool.name, arguments: sample(tool.inputSchema) }); } catch {}
    const scripts = [...vi.mocked(sendCommand).mock.calls, ...vi.mocked(sendRawCommand).mock.calls, ...vi.mocked(sendAfterEffectsCommand).mock.calls].map((c) => String(c[0]));
    for (const script of scripts) {
      scanned++;
      try { acorn.parse(script, { ecmaVersion: 3, allowReturnOutsideFunction: true }); }
      catch (e: any) {
        const line = script.split("\n")[e.loc.line - 1] ?? "";
        report.push(`${tool.name}: ${e.message} | ${line.trim().slice(0, 150)}`);
      }
    }
  }
  await client.close(); await server.close();
  for (const [label, source] of [["Premiere helpers", getHelpersSource()], ["After Effects helpers", getAfterEffectsHelpersSource()]]) {
    try { acorn.parse(source, { ecmaVersion: 3, allowReturnOutsideFunction: true }); }
    catch (e: any) { report.push(`${label}: ${e.message}`); }
  }
  expect(scanned).toBeGreaterThan(250);
  expect(report).toEqual([]);
}, 300000);

// Schema sampling may refuse a compound batch before dispatch; exercise a valid
// batch explicitly so its preflight and final-state receipt remain ES3 parsable.
it("batch insertion preflight and receipt script parse as ECMAScript 3", async () => {
  vi.mocked(sendCommand).mockClear();
  await getCompetitorGapTools({ timeoutMs: 50 }).add_to_timeline_batch.handler({
    clips: [{ item_id: "source", track_index: 0, start_seconds: 0, audio_track_index: 0 }],
  });
  expect(sendCommand).toHaveBeenCalledOnce();
  acorn.parse(String(vi.mocked(sendCommand).mock.calls[0][0]), { ecmaVersion: 3, allowReturnOutsideFunction: true });
});
