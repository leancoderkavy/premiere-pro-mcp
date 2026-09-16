import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createProjectBackup, getRecoveryTools } from "../src/tools/recovery.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe("createProjectBackup", () => {
  it("streams a byte-identical recovery copy and leaves the source unchanged", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "edit.prproj");
    const contents = Buffer.from("premiere-project-fixture\nrevision=7\n", "utf8");
    writeFileSync(source, contents);
    const before = statSync(source);

    const backup = createProjectBackup(source, new Date("2026-08-23T17:00:00.000Z"));
    expect(backup).toBeInstanceOf(Promise);
    const receipt = await backup;

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

  it("fails closed for non-project files, missing files, and backup-name collisions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const textFile = join(directory, "notes.txt");
    writeFileSync(textFile, "not a project");
    await expect(createProjectBackup(textFile)).rejects.toThrow(".prproj");
    await expect(createProjectBackup(join(directory, "missing.prproj"))).rejects.toThrow("does not exist");

    const project = join(directory, "edit.prproj");
    writeFileSync(project, "fixture");
    const now = new Date("2026-08-23T17:00:00.000Z");
    const first = await createProjectBackup(project, now);
    await expect(createProjectBackup(project, now)).rejects.toThrow();
    expect(readFileSync(first.backupPath, "utf8")).toBe("fixture");
  });

  it("refuses a project above the configured byte budget before creating a backup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "oversized.prproj");
    const now = new Date("2026-08-23T17:00:00.000Z");
    writeFileSync(source, "12345");

    await expect(createProjectBackup(source, now, { maxBytes: 4 })).rejects.toThrow(/4-byte backup budget/);

    expect(existsSync(`${source}.backup-2026-08-23T17-00-00-000Z`)).toBe(false);
  });

  it("rejects concurrent backup work instead of queueing unbounded file copies", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const firstSource = join(directory, "first.prproj");
    const secondSource = join(directory, "second.prproj");
    writeFileSync(firstSource, Buffer.alloc(4 * 1024 * 1024, 1));
    writeFileSync(secondSource, "second");

    const first = createProjectBackup(firstSource, new Date("2026-08-23T17:00:00.000Z"));
    await expect(createProjectBackup(secondSource, new Date("2026-08-23T17:00:01.000Z"))).rejects.toThrow(/already in progress/);
    await expect(first).resolves.toMatchObject({ sizeBytes: 4 * 1024 * 1024, byteIdentical: true });
  });

  it("honors cancellation before it reserves a collision-safe backup path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "cancelled.prproj");
    const now = new Date("2026-08-23T17:00:00.000Z");
    const controller = new AbortController();
    writeFileSync(source, "fixture");
    controller.abort();

    await expect(createProjectBackup(source, now, { signal: controller.signal })).rejects.toThrow(/cancelled/);

    expect(existsSync(`${source}.backup-2026-08-23T17-00-00-000Z`)).toBe(false);
  });

  it("removes a partial backup when streaming is cancelled", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "large.prproj");
    const now = new Date("2026-08-23T17:00:00.000Z");
    const backupPath = `${source}.backup-2026-08-23T17-00-00-000Z`;
    const descriptor = openSync(source, "w");
    ftruncateSync(descriptor, 16 * 1024 * 1024);
    closeSync(descriptor);
    const controller = new AbortController();

    try {
      const backup = createProjectBackup(source, now, { signal: controller.signal });
      await vi.waitFor(() => expect(existsSync(backupPath)).toBe(true), { interval: 1, timeout: 2000 });
      controller.abort();

      await expect(backup).rejects.toThrow(/cancelled|AbortError|aborted/i);
      expect(existsSync(backupPath)).toBe(false);
    } finally {
      // Rejection must mean file handles are closed, not just that copying has
      // stopped. Windows cannot remove the directory with a pending source handle.
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes both files when cancellation happens while the destination opens", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "opening.prproj");
    const now = new Date("2026-08-23T17:00:00.000Z");
    const backupPath = `${source}.backup-2026-08-23T17-00-00-000Z`;
    const controller = new AbortController();
    writeFileSync(source, "fixture");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      controller.abort();
      return handle;
    });

    try {
      await expect(createProjectBackup(source, now, { signal: controller.signal }))
        .rejects.toThrow(/cancelled|AbortError|aborted/i);
      expect(existsSync(backupPath)).toBe(false);
      expect(readFileSync(source, "utf8")).toBe("fixture");
    } finally {
      vi.mocked(open).mockReset().mockImplementation(actual.open);
      // No retries: a rejected operation must have released its file handles.
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("validates the configured budget and regular-file boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const fakeProjectDirectory = join(directory, "folder.prproj");
    mkdirSync(fakeProjectDirectory);
    await expect(createProjectBackup(fakeProjectDirectory)).rejects.toThrow(/regular file/);

    const source = join(directory, "edit.prproj");
    writeFileSync(source, "fixture");
    const prior = process.env.PREMIERE_MCP_PROJECT_BACKUP_MAX_BYTES;
    process.env.PREMIERE_MCP_PROJECT_BACKUP_MAX_BYTES = "not-a-number";
    try {
      await expect(createProjectBackup(source)).rejects.toThrow(/positive safe integer/);
    } finally {
      if (prior === undefined) delete process.env.PREMIERE_MCP_PROJECT_BACKUP_MAX_BYTES;
      else process.env.PREMIERE_MCP_PROJECT_BACKUP_MAX_BYTES = prior;
    }
  });

  it("awaits the streaming receipt at the public tool boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "premiere-project-backup-"));
    const source = join(directory, "handler.prproj");
    writeFileSync(source, "fixture");
    const tool = getRecoveryTools({ tempDir: directory }).create_project_backup;

    const success = await tool.handler({ project_path: source });
    expect(success).toMatchObject({ success: true, data: { sourcePath: source, byteIdentical: true } });
    expect((success as any).data).not.toBeInstanceOf(Promise);
    await expect(tool.handler({ project_path: join(directory, "missing.prproj") })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("does not exist"),
    });
  });
});
