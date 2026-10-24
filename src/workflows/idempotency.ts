import { createHash } from "node:crypto";
import type { MutationReceipt } from "./mutation-receipt.js";

// In-process idempotency store for state-changing tool calls. A client that
// gives up on a slow call and retries it with the same idempotency_key gets the
// first call's status or outcome back instead of a second, duplicated edit.
//
// Retained per key: a SHA-256 of (tool, key), a SHA-256 of the canonical call
// arguments, the operation-log sequence, status, receipt outcome and, when it
// serializes to at most IDEMPOTENCY_RESULT_BYTES_LIMIT, the response already
// returned to the same client. Raw keys and raw arguments are never stored.
// Nothing here is written to disk, sent to telemetry or kept past a restart.

export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9._:-]+$";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_KEY_LIMIT = 200;
export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
export const IDEMPOTENCY_RESULT_BYTES_LIMIT = 16 * 1024;
export const IDEMPOTENCY_TOTAL_RESULT_BYTES_LIMIT = 1024 * 1024;

const KEY_REGEX = new RegExp(IDEMPOTENCY_KEY_PATTERN);

export const IDEMPOTENCY_KEY_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: IDEMPOTENCY_KEY_MAX_LENGTH,
  pattern: IDEMPOTENCY_KEY_PATTERN,
  description: "Optional client-chosen key (1-128 chars of A-Z a-z 0-9 . _ : -) for this intended edit. Pass a fresh key per edit and reuse it only when retrying that same edit, for example after a client-side timeout. A repeat with the same tool, key and arguments is not run again: while the first call is running it fails with IDEMPOTENCY_IN_PROGRESS (poll get_last_operations); after it finished it returns the original outcome marked replayed. A definite failure with nothing applied (receipt outcome not_applied) may be retried with the same key. Reusing a key with different arguments fails with IDEMPOTENCY_KEY_REUSED. Held in this server process memory only (200 keys, 1 hour); it does not survive a server restart. Read-only invocations are never deduplicated.",
} as const;

export type IdempotencyStatus = "running" | "succeeded" | "failed";

interface IdempotencyRecord {
  scope: string;
  argsHash: string;
  keyHashPrefix: string;
  sequence: number;
  status: IdempotencyStatus;
  outcome: MutationReceipt["outcome"] | null;
  response: unknown;
  responseBytes: number;
  createdAt: number;
  lastUsedAt: number;
}

export type IdempotencyClaim =
  | { kind: "new"; record: IdempotencyRecord }
  | { kind: "in_progress"; sequence: number; keyHashPrefix: string }
  | { kind: "reused"; sequence: number; keyHashPrefix: string }
  | { kind: "replay"; sequence: number; keyHashPrefix: string; status: IdempotencyStatus; outcome: MutationReceipt["outcome"] | null; response: unknown };

// Map preserves insertion order; touching a record re-inserts it, so the first
// entry is always the least recently used.
const records = new Map<string, IdempotencyRecord>();
let retainedResponseBytes = 0;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function hashArguments(args: unknown): string {
  return sha256(canonicalJson(args ?? {}));
}

/** Short non-reversible correlation tag; the raw key is never retained. */
export function idempotencyKeyHashPrefix(key: string): string {
  return sha256(`idempotency_key\u0000${key}`).slice(0, 12);
}

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH && KEY_REGEX.test(value);
}

function dropResponse(record: IdempotencyRecord): void {
  retainedResponseBytes -= record.responseBytes;
  record.response = undefined;
  record.responseBytes = 0;
}

function remove(record: IdempotencyRecord): void {
  dropResponse(record);
  records.delete(record.scope);
}

function prune(now: number): void {
  for (const record of Array.from(records.values())) {
    // Running calls are kept until they finish so a retry can never slip past them.
    if (record.status !== "running" && now - record.lastUsedAt > IDEMPOTENCY_TTL_MS) remove(record);
  }
  for (const record of Array.from(records.values())) {
    if (records.size <= IDEMPOTENCY_KEY_LIMIT) break;
    if (record.status !== "running") remove(record);
  }
}

function touch(record: IdempotencyRecord, now: number): void {
  record.lastUsedAt = now;
  records.delete(record.scope);
  records.set(record.scope, record);
}

/**
 * Look up (tool, key) and either reserve it for a new call or report why the
 * call must not run. Synchronous so two concurrent retries cannot both reserve.
 */
export function claimIdempotencyKey(tool: string, key: string, args: unknown, sequenceForNewCall: () => number, now = Date.now()): IdempotencyClaim {
  prune(now);
  const scope = sha256(`${tool}\u0000${key}`);
  const argsHash = hashArguments(args);
  const keyHashPrefix = idempotencyKeyHashPrefix(key);
  const existing = records.get(scope);
  if (existing) {
    touch(existing, now);
    if (existing.argsHash !== argsHash) return { kind: "reused", sequence: existing.sequence, keyHashPrefix };
    if (existing.status === "running") return { kind: "in_progress", sequence: existing.sequence, keyHashPrefix };
    // A definite failure that applied nothing is safe to retry. Anything else
    // (success, or a failure whose effect is unknown or partly committed) is
    // replayed instead of risking a second application.
    if (!(existing.status === "failed" && existing.outcome === "not_applied")) {
      return { kind: "replay", sequence: existing.sequence, keyHashPrefix, status: existing.status, outcome: existing.outcome, response: existing.response };
    }
    remove(existing);
  }
  const record: IdempotencyRecord = {
    scope, argsHash, keyHashPrefix, sequence: sequenceForNewCall(), status: "running", outcome: null,
    response: undefined, responseBytes: 0, createdAt: now, lastUsedAt: now,
  };
  records.set(scope, record);
  prune(now);
  return { kind: "new", record };
}

/** Record how a reserved call ended. The first completion wins. */
export function completeIdempotencyKey(record: IdempotencyRecord, success: boolean, outcome: MutationReceipt["outcome"] | null, response: unknown, now = Date.now()): void {
  if (record.status !== "running") return;
  record.status = success ? "succeeded" : "failed";
  // A call that ended without a receipt has an unknown effect; never let it be retried blindly.
  record.outcome = outcome ?? "unknown";
  record.lastUsedAt = now;
  if (records.get(record.scope) !== record) return;
  let serialized: string | undefined;
  try { serialized = JSON.stringify(response); } catch { serialized = undefined; }
  const bytes = serialized === undefined ? Infinity : Buffer.byteLength(serialized);
  if (bytes <= IDEMPOTENCY_RESULT_BYTES_LIMIT) {
    // Evict the oldest retained responses (keeping their outcome) to honor the total bound.
    for (const other of records.values()) {
      if (retainedResponseBytes + bytes <= IDEMPOTENCY_TOTAL_RESULT_BYTES_LIMIT) break;
      if (other !== record && other.responseBytes > 0) dropResponse(other);
    }
    record.response = JSON.parse(serialized!);
    record.responseBytes = bytes;
    retainedResponseBytes += bytes;
  }
  prune(now);
}

export function idempotencyStoreStats(): { keys: number; retainedResponseBytes: number } {
  return { keys: records.size, retainedResponseBytes };
}

export function resetIdempotencyStore(): void {
  records.clear();
  retainedResponseBytes = 0;
}

interface ToolResponse {
  structuredContent: Record<string, unknown>;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** MCP response for a claim that must not run: an in-progress or mismatched duplicate, or a replay. */
export function idempotencyResponse(tool: string, claim: Exclude<IdempotencyClaim, { kind: "new" }>): ToolResponse {
  const idempotency = { replayed: claim.kind === "replay", sequence: claim.sequence, idempotencyKeyHash: claim.keyHashPrefix };
  const refuse = (code: string, message: string): ToolResponse => {
    const error = `${code}: ${message}`;
    return {
      structuredContent: { ok: false, tool, error, data: { code, ...idempotency }, idempotency: { ...idempotency, status: claim.kind === "in_progress" ? "running" : "refused" } },
      content: [{ type: "text", text: `Error: ${error}` }],
      isError: true,
    };
  };
  if (claim.kind === "in_progress") {
    return refuse("IDEMPOTENCY_IN_PROGRESS", `operation #${claim.sequence} with this idempotency_key is still running; it was not started again. Poll get_last_operations until it finishes, then retry with the same key to get its outcome.`);
  }
  if (claim.kind === "reused") {
    return refuse("IDEMPOTENCY_KEY_REUSED", `this idempotency_key was already used for operation #${claim.sequence} of this tool with different arguments; nothing was run. Use a fresh key for a different edit.`);
  }
  const meta = { ...idempotency, status: claim.status, outcome: claim.outcome };
  const note = `Replayed the recorded outcome of operation #${claim.sequence} (${claim.status}, ${claim.outcome ?? "unknown"}); the call was not run again.`;
  const stored = claim.response as ToolResponse | undefined;
  if (stored && typeof stored === "object" && stored.structuredContent && Array.isArray(stored.content)) {
    return { ...stored, structuredContent: { ...stored.structuredContent, idempotency: meta }, content: [...stored.content, { type: "text", text: note }] };
  }
  const success = claim.status === "succeeded";
  return {
    structuredContent: {
      ok: success,
      tool,
      ...(success ? {} : { error: `IDEMPOTENCY_REPLAY: original call failed with outcome ${claim.outcome ?? "unknown"}; inspect the affected targets before any dependent edit.` }),
      data: { replayed: true, originalResultRetained: false },
      idempotency: meta,
    },
    content: [{ type: "text", text: `${note} The original result exceeded ${IDEMPOTENCY_RESULT_BYTES_LIMIT} bytes or was evicted, so it was not retained; read the affected state back.` }],
    ...(success ? {} : { isError: true }),
  };
}
