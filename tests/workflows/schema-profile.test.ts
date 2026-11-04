import { describe, expect, it } from "vitest";
import { resolveSchemaProfile, SESSION_GUARD_TOOL_NAME } from "../../src/workflows/schema-profile.js";

describe("schema profile", () => {
  it("defaults to the full profile when unconfigured", () => {
    expect(resolveSchemaProfile(undefined, "default")).toEqual({ source: "default", profile: "full", compactGuards: false });
    expect(resolveSchemaProfile("  ", "default")).toEqual({ source: "default", profile: "full", compactGuards: false });
  });

  it("selects compact case-insensitively", () => {
    expect(resolveSchemaProfile(" Compact ", "explicit")).toEqual({ source: "explicit", profile: "compact", compactGuards: true });
    expect(resolveSchemaProfile("full", "environment")).toEqual({ source: "environment", profile: "full", compactGuards: false });
  });

  it("rejects an unknown profile at startup", () => {
    expect(() => resolveSchemaProfile("tiny", "explicit")).toThrow(/Unknown Premiere MCP schema profile "tiny"/);
  });

  it("names the session guard tool", () => {
    expect(SESSION_GUARD_TOOL_NAME).toBe("set_session_guard");
  });
});
