import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendCommand } = vi.hoisted(() => ({ sendCommand: vi.fn() }));

vi.mock("../src/bridge/file-bridge.js", () => ({
  sendCommand,
}));

import { getLiveContextResources } from "../src/resources/live-context-resources.js";

describe("live context resources", () => {
  beforeEach(() => {
    sendCommand.mockReset();
  });

  it("defines five bounded, read-only resource endpoints", () => {
    const resources = getLiveContextResources({ timeoutMs: 10 });

    expect(resources.map((resource) => resource.uri)).toEqual([
      "premiere://project/info",
      "premiere://project/sequences",
      "premiere://project/media",
      "premiere://project/bins",
      "premiere://timeline/active",
    ]);
    expect(resources.every((resource) => resource.description.includes("read-only") || resource.description.includes("path-redacted"))).toBe(true);
  });

  it("returns a revisioned, path-safe JSON snapshot", async () => {
    sendCommand.mockResolvedValueOnce({
      success: true,
      data: { project: { name: "Edit" }, privacy: { nativePaths: "not returned" } },
    });
    const resource = getLiveContextResources({ timeoutMs: 10 })[0];
    const output = await resource.read(new URL(resource.uri));
    const snapshot = JSON.parse(output.contents[0].text);

    expect(snapshot).toMatchObject({
      ok: true,
      resource: "premiere://project/info",
      resourceSchemaVersion: 1,
      backend: "cep",
      data: { project: { name: "Edit" } },
    });
    expect(snapshot.snapshotRevision).toMatch(/^[a-f0-9]{20}$/);
    expect(output.contents[0].uri).toBe("premiere://project/info");
  });

  it("returns a structured resource failure without fabricating host data", async () => {
    sendCommand.mockResolvedValueOnce({ success: false, error: "CEP bridge offline" });
    const resource = getLiveContextResources({ timeoutMs: 10 })[2];
    const output = await resource.read(new URL(resource.uri));
    const snapshot = JSON.parse(output.contents[0].text);

    expect(snapshot).toMatchObject({
      ok: false,
      resource: "premiere://project/media",
      error: "CEP bridge offline",
    });
    expect(snapshot).not.toHaveProperty("data");
  });
});
