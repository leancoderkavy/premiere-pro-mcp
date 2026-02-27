import { describe, it, expect } from "vitest";
import { buildScript, escapeForExtendScript, buildToolScript } from "../../src/bridge/script-builder.js";

describe("buildScript", () => {
  it("wraps code in an IIFE with try/catch", () => {
    const result = buildScript("return __result({ ok: true });");
    expect(result).toContain("(function() {");
    expect(result).toContain("return __result({ ok: true });");
    expect(result).toContain("} catch(e) {");
    expect(result).toContain("return __error(e.toString());");
    expect(result).toContain("})();");
  });

  it("prepends helper functions", () => {
    const result = buildScript("return __result({});");
    expect(result).toContain("var TICKS_PER_SECOND = 254016000000;");
    expect(result).toContain("function __ticksToSeconds(ticks)");
    expect(result).toContain("function __secondsToTicks(seconds)");
    expect(result).toContain("function __ticksToTimecode(ticks, fps)");
    expect(result).toContain("function __pad(n)");
    expect(result).toContain("function __findSequence(idOrName)");
    expect(result).toContain("function __findProjectItem(nodeIdOrName, rootItem)");
    expect(result).toContain("function __findClip(nodeId)");
    expect(result).toContain("function __getAllClips(seq)");
    expect(result).toContain("function __jsonStringify(obj)");
    expect(result).toContain("function __result(data)");
    expect(result).toContain("function __error(msg)");
  });

  it("preserves multi-line code blocks", () => {
    const code = `var x = 1;
    var y = 2;
    return __result({ sum: x + y });`;
    const result = buildScript(code);
    expect(result).toContain("var x = 1;");
    expect(result).toContain("var y = 2;");
    expect(result).toContain("return __result({ sum: x + y });");
  });

  it("handles empty code", () => {
    const result = buildScript("");
    expect(result).toContain("(function() {");
    expect(result).toContain("})();");
  });

  it("returns a string", () => {
    expect(typeof buildScript("")).toBe("string");
  });
});

describe("buildToolScript (alias)", () => {
  it("is the same function as buildScript", () => {
    expect(buildToolScript).toBe(buildScript);
  });

  it("produces identical output to buildScript", () => {
    const code = "return __result({ test: true });";
    expect(buildToolScript(code)).toBe(buildScript(code));
  });
});

describe("escapeForExtendScript", () => {
  it("escapes backslashes", () => {
    expect(escapeForExtendScript("C:\\Users\\test")).toBe("C:\\\\Users\\\\test");
  });

  it("escapes double quotes", () => {
    expect(escapeForExtendScript('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes single quotes", () => {
    expect(escapeForExtendScript("it's")).toBe("it\\'s");
  });

  it("escapes newlines", () => {
    expect(escapeForExtendScript("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeForExtendScript("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes tabs", () => {
    expect(escapeForExtendScript("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("handles empty strings", () => {
    expect(escapeForExtendScript("")).toBe("");
  });

  it("handles strings with no special characters", () => {
    expect(escapeForExtendScript("hello world")).toBe("hello world");
  });

  it("handles multiple escape characters in one string", () => {
    const input = 'C:\\path\\to\n"file"\t\'test\'';
    const result = escapeForExtendScript(input);
    expect(result).toBe('C:\\\\path\\\\to\\n\\"file\\"\\t\\\'test\\\'');
  });

  it("handles unicode characters (passes through)", () => {
    expect(escapeForExtendScript("日本語")).toBe("日本語");
  });
});

describe("generated script structure", () => {
  it("helpers appear before the IIFE", () => {
    const result = buildScript("return __result({});");
    const helpersEnd = result.indexOf("// === End MCP Bridge Helpers ===");
    const iifeStart = result.indexOf("(function() {");
    expect(helpersEnd).toBeLessThan(iifeStart);
    expect(helpersEnd).toBeGreaterThan(-1);
    expect(iifeStart).toBeGreaterThan(-1);
  });

  it("__findProjectItem recursively searches bins", () => {
    const result = buildScript("");
    expect(result).toContain("if (item.type === 2)");
    expect(result).toContain("var found = __findProjectItem(nodeIdOrName, item);");
  });

  it("__findClip searches both video and audio tracks", () => {
    const result = buildScript("");
    expect(result).toContain("seq.videoTracks.numTracks");
    expect(result).toContain("seq.audioTracks.numTracks");
    expect(result).toContain('trackType: "video"');
    expect(result).toContain('trackType: "audio"');
  });

  it("__jsonStringify handles all types", () => {
    const result = buildScript("");
    expect(result).toContain('if (obj === null) return "null"');
    expect(result).toContain('if (typeof obj === "string")');
    expect(result).toContain('if (typeof obj === "number"');
    expect(result).toContain("if (obj instanceof Array)");
    expect(result).toContain('if (typeof obj === "object")');
  });
});
