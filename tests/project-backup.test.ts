import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectBackup } from "../src/tools/recovery.js";

describe("createProjectBackup", () => {
  it("proves the recovery copy is byte-identical and leaves the source unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "edit.prproj");
    const contents = Buffer.from("premiere-project-fixture\nrevision=7\n", "utf8");
    writeFileSync(source, contents);
    const before = statSync(source);

    const receipt = createProjectBackup(source, new Date("2026-08-23T17:00:00.000Z"));

    expect(receipt).toMatchObject({
      sourcePath: source,
      sourceUnchanged: true,
      byteIdentical: true,
      sizeBytes: contents.length,
    });
    expect(readFileSync(source)).toEqual(contents);
    expect(readFileSync(receipt.backupPath)).toEqual(contents);
    expect(statSync(source).mtimeMs).toBe(before.mtimeMs);
  });

  it("fails closed for non-project files, missing files, and backup-name collisions", () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const textFile = join(directory, "notes.txt");
    writeFileSync(textFile, "not a project");
    expect(() => createProjectBackup(textFile)).toThrow(".prproj");
    expect(() => createProjectBackup(join(directory, "missing.prproj"))).toThrow("does not exist");

    const project = join(directory, "edit.prproj");
    writeFileSync(project, "fixture");
    const now = new Date("2026-08-23T17:00:00.000Z");
    createProjectBackup(project, now);
    expect(() => createProjectBackup(project, now)).toThrow();
  });
});
