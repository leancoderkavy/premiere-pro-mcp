import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertNoSymlinkedPaths, findSymlinkedSegment, SymlinkPathError } from "../../src/security/path-guard.js";

// Directory junctions need no elevation on Windows; POSIX uses plain symlinks.
const base = mkdtempSync(join(tmpdir(), "path-guard-"));
const workspace = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(join(workspace, "media"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(workspace, "media", "clip.mp4"), "x");
writeFileSync(join(outside, "secret.mp4"), "x");
const linkedDir = join(workspace, "linked");
symlinkSync(outside, linkedDir, process.platform === "win32" ? "junction" : "dir");

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("server-side symlink confinement for UXP paths (#640)", () => {
  it("allows real files, new output files, and non-path strings", () => {
    expect(findSymlinkedSegment(join(workspace, "media", "clip.mp4"))).toBeNull();
    expect(findSymlinkedSegment(join(workspace, "media", "new-export.png"))).toBeNull();
    expect(findSymlinkedSegment(join(workspace, "not-yet", "deeper", "out.mov"))).toBeNull();
    expect(() => assertNoSymlinkedPaths({
      mediaPath: join(workspace, "media", "clip.mp4"),
      caption: "Hello / world",
      url: "file:///tmp/x",
      relative: "media/clip.mp4",
      count: 3,
    })).not.toThrow();
  });

  it("refuses a file reached through a linked directory", () => {
    expect(findSymlinkedSegment(join(linkedDir, "secret.mp4"))).toBe(linkedDir);
  });

  it("refuses a linked output directory even when the leaf does not exist yet", () => {
    expect(findSymlinkedSegment(join(linkedDir, "frame.png"))).toBe(linkedDir);
  });

  it("finds linked paths nested in arrays and objects and names only the argument", () => {
    let caught: unknown;
    try {
      assertNoSymlinkedPaths({ items: [{ path: join(workspace, "media", "clip.mp4") }, { path: join(linkedDir, "secret.mp4") }] });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SymlinkPathError);
    expect((caught as SymlinkPathError).code).toBe("UXP_PATH_SYMLINK_REFUSED");
    expect((caught as Error).message).toContain("items[1].path");
    expect((caught as Error).message).not.toContain(outside);
    expect((caught as Error).message).toContain("No command was sent");
  });

  it("refuses a linked file on hosts that allow file symlinks", () => {
    const linkedFile = join(workspace, "media", "linked.mp4");
    try { symlinkSync(join(outside, "secret.mp4"), linkedFile, "file"); }
    catch { return; } // Windows without Developer Mode cannot create file symlinks.
    expect(findSymlinkedSegment(linkedFile)).toBe(linkedFile);
  });

  it("ignores strings that are not absolute local paths", () => {
    expect(findSymlinkedSegment("relative/linked/secret.mp4")).toBeNull();
    expect(findSymlinkedSegment("//server/share")).toBeNull();
    expect(findSymlinkedSegment(`${linkedDir}\0`)).toBeNull();
  });
});
