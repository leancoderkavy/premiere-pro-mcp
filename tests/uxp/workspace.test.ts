import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Workspace = require("../../uxp-plugin/workspace.cjs");

function storageFixture() {
  const files = new Map<string, string>();
  const dataFolder = {
    getEntry: vi.fn(async (name: string) => {
      if (!files.has(name)) throw new Error("missing");
      return {
        read: vi.fn(async () => files.get(name)),
        delete: vi.fn(async () => { files.delete(name); return 0; }),
      };
    }),
    createFile: vi.fn(async (name: string) => ({
      write: vi.fn(async (value: string) => { files.set(name, value); }),
    })),
  };
  const root = { isFolder: true, name: "Approved Media", nativePath: "D:\\Projects\\Film" };
  const fs = {
    getDataFolder: vi.fn(async () => dataFolder),
    getFolder: vi.fn(async () => root),
    createPersistentToken: vi.fn(async () => "persistent-capability-token"),
    getEntryForPersistentToken: vi.fn(async () => root),
  };
  return { fs, files };
}

describe("least-privilege UXP workspace broker", () => {
  it("normalizes absolute paths without allowing root traversal", () => {
    expect(Workspace.parseAbsolutePath("D:\\Projects\\Film\\media\\..\\clip.mov", "path")).toMatchObject({
      normalized: "D:/Projects/Film/clip.mov",
      kind: "windows",
    });
    expect(Workspace.isContained("D:\\Projects\\Film", "d:/projects/film/clip.mov", false)).toBe(true);
    expect(Workspace.isContained("D:\\Projects\\Film", "D:/Projects/Filmography/clip.mov", false)).toBe(false);
    expect(Workspace.parseAbsolutePath("/Projects/Film\\Archive/clip.mov", "path")).toMatchObject({
      normalized: "/Projects/Film\\Archive/clip.mov",
      kind: "posix",
    });
    expect(Workspace.isContained("/Projects/Film\\Archive", "/Projects/Film/Archive/clip.mov", false)).toBe(false);
    expect(() => Workspace.parseAbsolutePath("D:/../Windows/system.ini", "path")).toThrow("escapes");
    expect(() => Workspace.parseAbsolutePath("D:/Projects/Film/NUL", "path")).toThrow("Windows-ambiguous");
    expect(() => Workspace.parseAbsolutePath("D:/Projects/Film/clip.mov:stream", "path")).toThrow("Windows-ambiguous");
  });

  it("accepts only the manifest's exact loopback WebSocket endpoint", () => {
    expect(Workspace.validateLoopbackBridgeUrl("ws://127.0.0.1:7777/uxp?ignored=true").toString())
      .toBe("ws://127.0.0.1:7777/uxp");
    expect(Workspace.validateLoopbackBridgeUrl("ws://localhost:9000/uxp").hostname).toBe("localhost");
    expect(() => Workspace.validateLoopbackBridgeUrl("wss://example.com/uxp")).toThrow("Bridge URL must");
    expect(() => Workspace.validateLoopbackBridgeUrl("ws://localhost.evil/uxp")).toThrow("Bridge URL must");
    expect(() => Workspace.validateLoopbackBridgeUrl("ws://localhost:7777/other")).toThrow("Bridge URL must");
  });

  it("persists only the opaque token and never discloses the native root", async () => {
    const fixture = storageFixture();
    const broker = Workspace.createWorkspaceBroker({ fs: fixture.fs });
    await expect(broker.requestRoot()).resolves.toEqual({
      configured: true,
      accessMode: "request",
      rootName: "Approved Media",
      persistent: true,
      pathDisclosure: "redacted",
    });
    expect(JSON.parse(fixture.files.get("workspace-access.json") ?? "{}")).toEqual({
      schemaVersion: 1,
      persistentToken: "persistent-capability-token",
    });
    expect(broker.assertPathAllowed("D:\\Projects\\Film\\exports\\edit.aaf", { label: "output", kind: "file" }))
      .toBe("D:/Projects/Film/exports/edit.aaf");
    try {
      broker.assertPathAllowed("D:\\Projects\\Other\\edit.aaf", { label: "output", kind: "file" });
      throw new Error("expected containment rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "UXP_PATH_OUTSIDE_WORKSPACE" });
    }
  });

  it("restores and revokes a persisted folder capability", async () => {
    const fixture = storageFixture();
    const first = Workspace.createWorkspaceBroker({ fs: fixture.fs });
    await first.requestRoot();
    const restored = Workspace.createWorkspaceBroker({ fs: fixture.fs });
    await expect(restored.initialize()).resolves.toMatchObject({ configured: true, rootName: "Approved Media" });
    expect(fixture.fs.getEntryForPersistentToken).toHaveBeenCalledWith("persistent-capability-token");
    await expect(restored.revoke()).resolves.toMatchObject({ configured: false, persistent: false });
    expect(fixture.files.has("workspace-access.json")).toBe(false);
  });

  it("rejects filesystem-root grants as broader than a project workspace", async () => {
    const fixture = storageFixture();
    fixture.fs.getFolder.mockResolvedValueOnce({ isFolder: true, name: "Drive", nativePath: "D:\\" });
    const broker = Workspace.createWorkspaceBroker({ fs: fixture.fs });
    await expect(broker.requestRoot()).rejects.toMatchObject({ code: "UXP_WORKSPACE_TOO_BROAD" });
    expect(fixture.files.size).toBe(0);
  });
});
