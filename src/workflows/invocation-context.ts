import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type OperationStage = "queue_wait" | "host_wait" | "dispatch" | "readback" | "analysis" | "artifact_validation";
export interface InvocationContext {
  signal?: AbortSignal;
  progressToken?: string | number;
  notify?: (notification: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
  dispatched: boolean;
  progress: number;
  notifications: number;
  lastNotificationAt: number;
  /** Liveness heartbeats sent during long host waits; budgeted separately from step progress. */
  heartbeats: number;
  stages: Partial<Record<OperationStage, number>>;
}
const storage = new AsyncLocalStorage<InvocationContext>();

export function withInvocationContext<T>(options: Pick<InvocationContext, "signal" | "progressToken" | "notify">, work: () => T): T {
  return storage.run({ ...options, dispatched: false, progress: -1, notifications: 0, lastNotificationAt: -Infinity, heartbeats: 0, stages: {} }, work);
}
export function currentInvocation(): InvocationContext | undefined { return storage.getStore(); }
/** Call immediately before sending a command, never while merely previewing. */
export function markHostDispatch(): void { const context = storage.getStore(); if (context) context.dispatched = true; }
export function assertInvocationNotCancelled(): void {
  if (storage.getStore()?.signal?.aborted) throw new Error("REQUEST_CANCELLED_BEFORE_DISPATCH: no further command was sent; an already accepted host job is not cancelled.");
}
/** Progress measures workflow steps unless explicitly supplied by the native job. */
export async function reportProgress(progress: number, total?: number, message?: string): Promise<void> {
  const context = storage.getStore();
  if (!context || context.progressToken === undefined || !context.notify || !Number.isFinite(progress) || progress < 0 || progress <= context.progress) return;
  if (total !== undefined && (!Number.isFinite(total) || total < progress)) return;
  const now = performance.now();
  if (context.notifications >= 100 || (now - context.lastNotificationAt < 250 && progress !== total)) return;
  context.progress = progress; context.notifications++; context.lastNotificationAt = now;
  // A failed client notification must never replay or change a host operation.
  try { await context.notify({ method: "notifications/progress", params: { progressToken: context.progressToken, progress, ...(total === undefined ? {} : { total }), ...(message ? { message: message.slice(0, 160) } : {}) } }); } catch { /* disconnected observer */ }
}
/** Enough heartbeats for a 240-minute wait at one per 10 s, with headroom. */
export const MAX_HOST_HEARTBEATS = 1_500;
/** Each heartbeat advances progress by this much; 1,500 of them stay below one whole step. */
const HEARTBEAT_PROGRESS_STEP = 1 / 2_048;

/**
 * Tell the client that the host is still working on a long command, so clients
 * that reset their request timeout on progress keep the call alive. The context
 * is passed explicitly because host-wait callbacks can run outside the invoking
 * async context. Heartbeats advance progress by a tiny step without a total, so
 * any later step or terminal notification still increases. No-op without a
 * progress token. A heartbeat proves only that the host is busy, never success.
 */
export async function reportHostHeartbeat(elapsedMs: number, context: InvocationContext | undefined = storage.getStore()): Promise<void> {
  if (!context || context.progressToken === undefined || !context.notify || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  if (context.heartbeats >= MAX_HOST_HEARTBEATS) return;
  const progress = Math.max(context.progress, 0) + HEARTBEAT_PROGRESS_STEP;
  context.progress = progress; context.heartbeats++;
  const message = `Host still working (${Math.round(elapsedMs / 1000)} s elapsed); outcome unverified.`;
  try { await context.notify({ method: "notifications/progress", params: { progressToken: context.progressToken, progress, message } }); } catch { /* disconnected observer */ }
}
export async function measureStage<T>(stage: OperationStage, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); } finally {
    const context = storage.getStore();
    if (context) context.stages[stage] = (context.stages[stage] ?? 0) + performance.now() - started;
  }
}

/** Capture the invoking context before asynchronous host callbacks leave it. */
export function startStage(stage: OperationStage, context = currentInvocation()): () => void {
  const started = performance.now();
  let recorded = false;
  return () => {
    if (!recorded && context) context.stages[stage] = (context.stages[stage] ?? 0) + performance.now() - started;
    recorded = true;
  };
}
export function measureStageSync<T>(stage: OperationStage, work: () => T, context = currentInvocation()): T {
  const finish = startStage(stage, context);
  try { return work(); } finally { finish(); }
}
