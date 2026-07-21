import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const protocol = require("../../uxp-plugin/protocol.cjs");

describe("UXP bridge protocol", () => {
  it("builds versioned envelopes", () => {
    const result = protocol.envelope("event", { name: "changed" }, "r1");
    expect(result).toMatchObject({ protocolVersion: 1, type: "event", requestId: "r1", payload: { name: "changed" } });
    expect(Date.parse(result.sentAt)).not.toBeNaN();
  });
  it("parses commands with safe defaults", () => {
    expect(protocol.parseCommand('{"type":"command","command":"state.get"}')).toEqual({ requestId: null, command: "state.get", args: {} });
  });
  it("rejects malformed commands", () => expect(() => protocol.parseCommand({ type: "event" })).toThrow("Invalid UXP bridge command"));
  it("prevents filename path traversal", () => {
    expect(protocol.safeFilename("shot-01.png")).toBe("shot-01.png");
    expect(() => protocol.safeFilename("../shot.png")).toThrow();
    expect(() => protocol.safeFilename("shot.jpg")).toThrow();
  });
  it("joins Windows and POSIX-style output paths", () => {
    expect(protocol.joinPath("C:/temp", "a.png")).toBe("C:/temp/a.png");
    expect(protocol.joinPath("C:/temp/", "a.png")).toBe("C:/temp/a.png");
  });
});
