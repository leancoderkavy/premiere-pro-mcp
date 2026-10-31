import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type LeaseOwnership = { directory: string; token: string; retain: boolean };
const leases = new AsyncLocalStorage<LeaseOwnership>();
const activeOwners = new Map<string, LeaseOwnership>();
const LOCK_DIRECTORY = ".host-owner-lease";
const RECOVERY_FILE = ".host-recovery.json";
export interface HostRecoveryState { version: 1; recoveryRequired: boolean; recoveryRevision: string | null; reason?: string; }
export class HostLeaseError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "HostLeaseError"; }
}
function privateRead(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))) throw new HostLeaseError("HOST_LEASE_UNSAFE", "Execution ownership record is unsafe; no command was dispatched");
  return readFileSync(path, "utf8");
}
export function inspectHostRecovery(directory: string): HostRecoveryState {
  const path = join(directory, RECOVERY_FILE);
  if (!existsSync(path)) return { version: 1, recoveryRequired: false, recoveryRevision: null };
  const raw = privateRead(path);
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !["unknown_command_outcome", "abandoned_process_lease"].includes(value.reason) || typeof value.nonce !== "string" || !/^[a-f0-9-]{36}$/.test(value.nonce) || Object.keys(value).some((key) => !["version", "reason", "nonce"].includes(key))) throw new HostLeaseError("HOST_RECOVERY_CORRUPT", "Execution recovery record cannot be validated");
  return { version: 1, recoveryRequired: true, recoveryRevision: createHash("sha256").update(raw).digest("hex"), reason: value.reason };
}
export function markHostRecovery(directory: string, reason: "unknown_command_outcome" | "abandoned_process_lease"): void {
  const path = join(directory, RECOVERY_FILE);
  if (existsSync(path)) { inspectHostRecovery(directory); return; }
  try { writeFileSync(path, JSON.stringify({ version: 1, reason, nonce: randomUUID() }), { mode: 0o600, flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") { const owner = leases.getStore()?.directory === directory ? leases.getStore() : activeOwners.get(directory); if (owner) owner.retain = true; throw error; } }
}
export function acknowledgeHostRecovery(directory: string, expectedRevision: string, reviewed: boolean): void {
  const state = inspectHostRecovery(directory);
  if (reviewed !== true || !state.recoveryRequired || state.recoveryRevision !== expectedRevision) throw new HostLeaseError("HOST_STALE_RECOVERY", "Acknowledgement must match the latest inspected recovery revision");
  unlinkSync(join(directory, RECOVERY_FILE));
}
export function ownsHostLease(directory: string): boolean { return leases.getStore()?.directory === directory; }
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
/** Coordinates cooperating MCP processes only; Premiere UI and other extensions are outside this lease. */
export async function withHostLease<T>(directory: string, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  if (ownsHostLease(directory)) return work();
  const lock = join(directory, LOCK_DIRECTORY), token = randomUUID(), started = Date.now();
  let attempted = false;
  for (;;) {
    if (attempted && Date.now() - started >= timeoutMs) throw new HostLeaseError("HOST_LEASE_BUSY", "Another cooperating MCP process owns Premiere execution; no command was dispatched");
    attempted = true;
    try {
      mkdirSync(lock, { mode: 0o700 });
      try { writeFileSync(join(lock, "owner.json"), JSON.stringify({ version: 1, pid: process.pid, token }), { flag: "wx", mode: 0o600 }); }
      catch (error) { rmdirSync(lock); throw error; }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stat;
      try { stat = lstatSync(lock); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue; throw statError; }
      if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))) throw new HostLeaseError("HOST_LEASE_UNSAFE", "Host lease directory is unsafe");
      const ownerPath = join(lock, "owner.json");
      if (existsSync(ownerPath)) {
        let owner: { version: number; pid: number; token: string };
        try { owner = JSON.parse(privateRead(ownerPath)); }
        catch (readError) {
          // A live owner can finish between existsSync/lstatSync/readFileSync.
          // Release races can surface as permission or parse errors as well as
          // ENOENT. Confirm disappearance before retrying; a record that still
          // exists or cannot be inspected must continue to fail closed.
          if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
          try { lstatSync(ownerPath); }
          catch (statError) { if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue; }
          throw new HostLeaseError("HOST_LEASE_UNSAFE", "Host owner record is unreadable; no command was dispatched");
        }
        if (owner?.version !== 1 || !Number.isInteger(owner.pid) || owner.pid <= 0 || owner.pid > 0x7fffffff || typeof owner.token !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(owner.token) || Object.keys(owner).some((key) => !["version", "pid", "token"].includes(key))) throw new HostLeaseError("HOST_LEASE_UNSAFE", "Invalid host owner record");
        if (!processAlive(owner.pid)) {
          // Never treat process death as proof that its accepted host edit stopped.
          markHostRecovery(directory, "abandoned_process_lease");
          // Reapers serialize separately and re-read ownership after acquiring
          // that lock. Otherwise a second reaper could remove a new live lease.
          const reaper = join(directory, ".host-owner-reaper");
          try {
            mkdirSync(reaper, { mode: 0o700 });
            try {
              const latest = JSON.parse(privateRead(ownerPath));
              if (latest.token === owner.token && latest.pid === owner.pid && !processAlive(latest.pid)) {
                unlinkSync(ownerPath);
                rmdirSync(lock);
              }
            } finally { rmdirSync(reaper); }
          } catch (reapError) { if (!["ENOENT", "EEXIST"].includes((reapError as NodeJS.ErrnoException).code || "")) throw reapError; }
          continue;
        }
      }
      if (Date.now() - started >= timeoutMs) throw new HostLeaseError("HOST_LEASE_BUSY", "Another cooperating MCP process owns Premiere execution; no command was dispatched");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  const ownership = { directory, token, retain: false };
  activeOwners.set(directory, ownership);
  try { return await leases.run(ownership, work); }
  finally {
    activeOwners.delete(directory);
    if (!ownership.retain) {
      let owner: { token?: string; pid?: number };
      try { owner = JSON.parse(privateRead(join(lock, "owner.json"))); }
      catch { markHostRecovery(directory, "unknown_command_outcome"); throw new HostLeaseError("HOST_LEASE_LOST", "Execution ownership could not be verified; inspect host state before another edit"); }
      if (owner.token !== token || owner.pid !== process.pid) { markHostRecovery(directory, "unknown_command_outcome"); throw new HostLeaseError("HOST_LEASE_LOST", "Execution lease changed; inspect host state before another edit"); }
      unlinkSync(join(lock, "owner.json"));
      rmdirSync(lock);
    }
  }
}
