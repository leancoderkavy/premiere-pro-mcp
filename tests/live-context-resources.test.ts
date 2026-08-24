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

  it("defines ten bounded, read-only resource endpoints", () => {
    const resources = getLiveContextResources({ timeoutMs: 10 });

    expect(resources.map((resource) => resource.uri)).toEqual([
      "premiere://project/info",
      "premiere://project/sequences",
      "premiere://project/media",
      "premiere://project/bins",
      "premiere://timeline/active",
      "premiere://effects/available",
      "premiere://effects/applied",
      "premiere://transitions/available",
      "premiere://export/presets",
      "premiere://project/metadata",
    ]);
    expect(resources.every((resource) => {
      const description = resource.description.toLowerCase();
      return description.includes("read-only") || description.includes("path-redacted");
    })).toBe(true);
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

  it("redacts unexpected path fields at the attachable-resource boundary", async () => {
    sendCommand.mockResolvedValueOnce({
      success: true,
      data: {
        presets: [{ name: "Match Source", path: "C:/Users/editor/private.epr" }],
        projectPath: "C:/Projects/private.prproj",
        nested: { tree_path: "Root/Private", fsName: "/tmp/private" },
      },
    });
    const resource = getLiveContextResources({ timeoutMs: 10 }).find(
      (candidate) => candidate.uri === "premiere://export/presets",
    );
    const output = await resource!.read(new URL(resource!.uri));
    const snapshot = JSON.parse(output.contents[0].text);

    expect(snapshot.data).toEqual({
      presets: [{ name: "Match Source" }],
      nested: {},
    });
    expect(output.contents[0].text).not.toContain("C:/");
  });
});
