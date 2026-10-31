import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withHostLease, ownsHostLease, inspectHostRecovery, markHostRecovery, acknowledgeHostRecovery } from "../../src/bridge/host-lease.js";
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const directories: string[] = [];
function directory() { const value = mkdtempSync(join(tmpdir(), "premiere-host-lease-")); directories.push(value); return value; }
afterEach(() => { vi.mocked(readFileSync).mockClear(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe("cooperating-process Premiere execution lease", () => {
  it("retries acquisition when a cooperating owner releases during owner read", async () => {
    const path = directory(), lock = join(path, ".host-owner-lease"), owner = join(lock, "owner.json");
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(owner, JSON.stringify({ version: 1, pid: process.pid, token: "finishing" }), { mode: 0o600 });
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      rmSync(lock, { recursive: true });
      throw Object.assign(new Error("owner released"), { code: "ENOENT" });
    });
    const work = vi.fn(async () => "acquired");
    await expect(withHostLease(path, 1000, work)).resolves.toBe("acquired");
    expect(work).toHaveBeenCalledOnce();
    expect(inspectHostRecovery(path).recoveryRequired).toBe(false);
  });
  it.each(["EACCES", "EPERM", "INVALID_JSON"])("retries a %s owner read only after confirming the record disappeared", async code => {
    const path = directory(), lock = join(path, ".host-owner-lease"), owner = join(lock, "owner.json");
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(owner, JSON.stringify({ version: 1, pid: process.pid, token: "finishing" }), { mode: 0o600 });
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      rmSync(lock, { recursive: true });
      if (code === "INVALID_JSON") throw new SyntaxError("owner contents unavailable during release");
      throw Object.assign(new Error("owner deletion in progress"), { code });
    });
    const work = vi.fn(async () => "acquired");
    await expect(withHostLease(path, 1000, work)).resolves.toBe("acquired");
    expect(work).toHaveBeenCalledOnce();
    expect(inspectHostRecovery(path).recoveryRequired).toBe(false);
  });
  it.each(["EACCES", "EPERM"])("refuses an unreadable %s owner record that still exists", async code => {
    const path = directory(), lock = join(path, ".host-owner-lease"), owner = join(lock, "owner.json");
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(owner, JSON.stringify({ version: 1, pid: process.pid, token: "other" }), { mode: 0o600 });
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("owner remains unreadable"), { code });
    });
    const work = vi.fn();
    await expect(withHostLease(path, 1000, work)).rejects.toMatchObject({ code: "HOST_LEASE_UNSAFE" });
    expect(work).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(owner, "utf8")).token).toBe("other");
  });
  it("holds inspect/apply/readback ownership across nested work", async () => {
    const path = directory(), events: string[] = [];
    await withHostLease(path, 200, async () => {
      expect(ownsHostLease(path)).toBe(true);
      events.push("inspect");
      await withHostLease(path, 200, async () => events.push("apply"));
      events.push("readback");
    });
    expect(events).toEqual(["inspect", "apply", "readback"]);
    expect(ownsHostLease(path)).toBe(false);
    expect(existsSync(join(path, ".host-owner-lease"))).toBe(false);
  });
  it("serializes an independently running process and never interleaves its protected workflow", async () => {
    const path = directory(), eventsPath = join(path, "events.txt");
    // A second Node process uses the same atomic on-disk ownership protocol.
    // No copied project data or credentials are passed to the child.
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { mkdirSync, writeFileSync, appendFileSync, unlinkSync, rmdirSync } from 'node:fs';
      import { join } from 'node:path';
      const dir = process.argv[1], lock = join(dir, '.host-owner-lease');
      mkdirSync(lock, {mode:448});
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({version:1,pid:process.pid,token:'child'}), {mode:384});
      appendFileSync(join(dir,'events.txt'), 'child-inspect\\n');
      process.stdout.write('ready\\n');
      await new Promise(resolve => setTimeout(resolve, 150));
      appendFileSync(join(dir,'events.txt'), 'child-apply\\nchild-readback\\n');
      unlinkSync(join(lock,'owner.json')); rmdirSync(lock);
    `, path], { stdio: ["ignore", "pipe", "pipe"] });
    await once(child.stdout, "data");
    await withHostLease(path, 1000, async () => writeFileSync(eventsPath, readFileSync(eventsPath, "utf8") + "parent-inspect\nparent-apply\nparent-readback\n"));
    if (child.exitCode === null) await once(child, "exit");
    expect(readFileSync(eventsPath, "utf8").trim().split("\n")).toEqual(["child-inspect", "child-apply", "child-readback", "parent-inspect", "parent-apply", "parent-readback"]);
  });
  it("does not steal a live lease when its local wait expires", async () => {
    const path = directory(), lock = join(path, ".host-owner-lease");
    mkdirSync(lock, { mode: 0o700 }); writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, pid: process.pid, token: "other" }), { mode: 0o600 });
    const work = vi.fn();
    await expect(withHostLease(path, 1, work)).rejects.toMatchObject({ code: "HOST_LEASE_BUSY" });
    expect(work).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).token).toBe("other");
  });
  it("marks process death unknown, permits inspection and requires exact reviewed recovery", async () => {
    const path = directory(), lock = join(path, ".host-owner-lease");
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" }); await once(child, "exit");
    mkdirSync(lock, { mode: 0o700 }); writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, pid: child.pid, token: "dead" }), { mode: 0o600 });
    // Reaping the dead owner takes several fs calls; under Windows coverage runs
    // they can exceed a 100 ms budget before the retry acquires the lease.
    await withHostLease(path, 2000, async () => expect(inspectHostRecovery(path)).toMatchObject({ recoveryRequired: true, reason: "abandoned_process_lease" }));
    const state = inspectHostRecovery(path);
    expect(() => acknowledgeHostRecovery(path, "stale", true)).toThrow(/latest inspected/);
    expect(() => acknowledgeHostRecovery(path, state.recoveryRevision!, false)).toThrow(/latest inspected/);
    acknowledgeHostRecovery(path, state.recoveryRevision!, true);
    expect(inspectHostRecovery(path).recoveryRequired).toBe(false);
  });
  it("retains one private recovery nonce and rejects unsafe ownership records", async () => {
    const path = directory();
    markHostRecovery(path, "unknown_command_outcome"); const before = inspectHostRecovery(path);
    markHostRecovery(path, "abandoned_process_lease"); expect(inspectHostRecovery(path)).toEqual(before);
    const lock = join(path, ".host-owner-lease"); mkdirSync(lock, { mode: 0o700 });
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, pid: -1, token: "bad" }), { mode: 0o600 });
    await expect(withHostLease(path, 1, async () => undefined)).rejects.toMatchObject({ code: "HOST_LEASE_UNSAFE" });
    if (process.platform !== "win32") {
      chmodSync(join(path, ".host-recovery.json"), 0o644);
      expect(() => inspectHostRecovery(path)).toThrow(/unsafe/);
    }
  });
  it("fails closed on lease ownership replacement", async () => {
    const path = directory();
    await expect(withHostLease(path, 100, async () => writeFileSync(join(path, ".host-owner-lease", "owner.json"), JSON.stringify({ version: 1, pid: process.pid, token: "replacement" }), { mode: 0o600 }))).rejects.toMatchObject({ code: "HOST_LEASE_LOST" });
    expect(inspectHostRecovery(path).recoveryRequired).toBe(true);
  });
  it("fails closed when an in-flight owner record disappears", async () => {
    const path = directory();
    await expect(withHostLease(path, 100, async () => unlinkSync(join(path, ".host-owner-lease", "owner.json")))).rejects.toMatchObject({ code: "HOST_LEASE_LOST" });
    expect(inspectHostRecovery(path).recoveryRequired).toBe(true);
    await expect(withHostLease(path, 1, async () => undefined)).rejects.toMatchObject({ code: "HOST_LEASE_BUSY" });
  });
  it("retains ownership if disk permissions prevent persisting an unknown receipt", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const path = directory();
    await withHostLease(path, 100, async () => {
      chmodSync(path, 0o500);
      try { expect(() => markHostRecovery(path, "unknown_command_outcome")).toThrow(); }
      finally { chmodSync(path, 0o700); }
    });
    expect(existsSync(join(path, ".host-owner-lease", "owner.json"))).toBe(true);
    await expect(withHostLease(path, 1, async () => undefined)).rejects.toMatchObject({ code: "HOST_LEASE_BUSY" });
  });
  it("refuses unreadable, oversized and malformed private owner records", async () => {
    const path = directory(), lock = join(path, ".host-owner-lease"), owner = join(lock, "owner.json");
    mkdirSync(lock, { mode: 0o700 });
    for (const raw of ["{broken", "x".repeat(4097), "null", JSON.stringify({ version: 1, pid: Number.MAX_SAFE_INTEGER, token: "bad" })]) {
      writeFileSync(owner, raw, { mode: 0o600 });
      await expect(withHostLease(path, 1, async () => undefined)).rejects.toMatchObject({ code: "HOST_LEASE_UNSAFE" });
    }
  });
  it("refuses symlinked leases and corrupt recovery records", async () => {
    const path = directory(), target = directory();
    if (process.platform !== "win32") { symlinkSync(target, join(path, ".host-owner-lease")); await expect(withHostLease(path, 1, async () => undefined)).rejects.toMatchObject({ code: "HOST_LEASE_UNSAFE" }); }
    writeFileSync(join(path, ".host-recovery.json"), JSON.stringify({ version: 9 }), { mode: 0o600 });
    expect(() => inspectHostRecovery(path)).toThrow(/cannot be validated/);
  });
});
