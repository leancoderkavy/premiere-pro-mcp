import type { MutationReceipt } from "./mutation-receipt.js";

// In-memory record of the most recent state-changing tool calls in this server
// process. A client can give up on a long call (its own request timeout) while
// the server keeps waiting for Premiere; retrying then queues the same edit a
// second time. get_last_operations lets the client see whether that call is
// still running or how it ended before it retries. Only the tool name, timing
// and outcome are kept: never arguments, results, paths or media names.
export interface OperationLogEntry {
  sequence: number;
  tool: string;
  status: "running" | "succeeded" | "failed";
  outcome: MutationReceipt["outcome"] | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Short SHA-256 prefix of the call's idempotency_key, or null; the raw key is never kept. */
  idempotencyKeyHash: string | null;
}

export const OPERATION_LOG_LIMIT = 50;
const entries: OperationLogEntry[] = [];
// Active calls must survive history eviction until their first result arrives.
const active = new Map<number, OperationLogEntry>();
let nextSequence = 1;

export function beginOperation(tool: string, now = Date.now(), idempotencyKeyHash: string | null = null): OperationLogEntry {
  const entry: OperationLogEntry = {
    sequence: nextSequence++,
    tool,
    status: "running",
    outcome: null,
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    durationMs: null,
    idempotencyKeyHash,
  };
  active.set(entry.sequence, entry);
  entries.push(entry);
  if (entries.length > OPERATION_LOG_LIMIT) entries.splice(0, entries.length - OPERATION_LOG_LIMIT);
  return entry;
}

export function finishOperation(entry: OperationLogEntry, success: boolean, outcome: MutationReceipt["outcome"], now = Date.now()): void {
  // The first result wins; later structured results for the same call are ignored.
  if (entry.status !== "running") return;
  if (active.get(entry.sequence) === entry) active.delete(entry.sequence);
  entry.status = success ? "succeeded" : "failed";
  entry.outcome = outcome;
  entry.finishedAt = new Date(now).toISOString();
  entry.durationMs = Math.max(0, now - Date.parse(entry.startedAt));
}

/** Newest first. */
export function recentOperations(limit = 10): OperationLogEntry[] {
  return entries.slice(-Math.max(1, Math.min(OPERATION_LOG_LIMIT, limit))).reverse().map((entry) => ({ ...entry }));
}

/** Active-call count is independent of the bounded recent-history window. */
export function runningOperations(limit = 10): { count: number; operations: OperationLogEntry[]; truncated: boolean } {
  const operations = Array.from(active.values()).slice(-Math.max(1, Math.min(OPERATION_LOG_LIMIT, limit))).reverse().map((entry) => ({ ...entry }));
  return { count: active.size, operations, truncated: active.size > operations.length };
}

export function resetOperationLog(): void {
  entries.length = 0;
  active.clear();
  nextSequence = 1;
}
