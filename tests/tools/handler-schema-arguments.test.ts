import { describe, expect, it, vi } from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { collectTools } from "../../src/server.js";
import { resolveCapabilities } from "../../src/security/index.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

// Unknown top-level arguments are rejected (additionalProperties: false), so a
// handler that reads an argument its schema does not declare can never receive
// it: the tool would silently run with its default. Keep handlers and schemas
// in step.
//
// Best-effort: this scans only each handler's own source text. It does not see
// arguments read inside helpers the handler passes `args` to (for example
// parseMediaReportPaging), so declare those arguments by hand and cover them
// in the helper's own tests.
const tools = collectTools(
  { tempDir: "/tmp/handler-schema-arguments" },
  resolveCapabilities("inspect,edit,export,filesystem,unsafe-script"),
  {} as UxpWebSocketBridge,
);

function argumentsRead(source: string): string[] {
  const names = new Set<string>();
  const parameter = /^\s*(?:async\s*)?(?:function\s*\w*\s*)?\(\s*([A-Za-z_$][\w$]*)/.exec(source)?.[1];
  if (parameter) {
    const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of source.matchAll(new RegExp(`\\b${escaped}\\??\\.([A-Za-z_][\\w]*)`, "g"))) names.add(match[1]);
    for (const match of source.matchAll(new RegExp(`\\b${escaped}\\[\\s*["'\`]([^"'\`]+)["'\`]\\s*\\]`, "g"))) names.add(match[1]);
  }
  const destructured = /^\s*(?:async\s*)?\(\s*\{([^}]*)\}/.exec(source)?.[1];
  if (destructured) {
    for (const part of destructured.split(",")) {
      const name = part.split(/[:=]/)[0].trim().replace(/^\.\.\./, "");
      if (name) names.add(name);
    }
  }
  return [...names];
}

describe("tool handlers only read arguments their schema declares", () => {
  it("covers the whole catalog", () => {
    expect(Object.keys(tools).length).toBeGreaterThan(300);
  });

  it("finds no undeclared argument reads", () => {
    const problems: string[] = [];
    let reads = 0;
    for (const [name, tool] of Object.entries(tools)) {
      const parameters = tool.parameters as { properties?: Record<string, unknown>; additionalProperties?: unknown; patternProperties?: unknown } | undefined;
      if (!parameters || parameters.additionalProperties !== undefined || parameters.patternProperties !== undefined) continue;
      const declared = new Set(Object.keys(parameters.properties ?? {}));
      const read = argumentsRead(tool.handler.toString());
      reads += read.length;
      const undeclared = read.filter((argument) => !declared.has(argument));
      if (undeclared.length) problems.push(`${name}: ${undeclared.join(", ")}`);
    }
    expect(problems).toEqual([]);
    // The scan must actually see the handlers' reads.
    expect(reads).toBeGreaterThan(500);
  });

  it("detects an undeclared read", () => {
    expect(argumentsRead("async (args) => args.item_ID ?? args.item_id")).toEqual(["item_ID", "item_id"]);
    expect(argumentsRead("async ({ node_id, force = false }) => node_id")).toEqual(["node_id", "force"]);
  });
});
