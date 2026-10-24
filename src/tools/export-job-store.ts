import { randomBytes } from "node:crypto";

/**
 * In-process registry for Adobe Media Encoder sequence-export jobs started by
 * export_sequence_job_start. It lives only as long as this MCP server process:
 * a restarted server cannot see jobs an earlier process started, and says so
 * instead of guessing. Records hold the output path for local verification but
 * are never sent to telemetry.
 */

export type ExportJobStatus = "queued" | "encoding" | "finalizing" | "completed" | "failed" | "cancelled" | "unknown";

export interface ExportJobObservation {
  exists: boolean;
  sizeBytes: number | null;
  modifiedMs: number | null;
  observedAt: number;
}

export interface ExportJobRecord {
  id: string;
  ameJobId: string;
  outputPath: string;
  presetPath: string;
  range: "entire" | "in_to_out" | "work_area";
  expectedDurationSeconds: number | null;
  frameDurationSeconds: number | null;
  queueBatchStart: string;
  eventsBound: boolean;
  startedAt: number;
  lastObservation?: ExportJobObservation;
  /** A terminal report is cached so later polls do not re-render a decision. */
  terminal?: { status: ExportJobStatus; data: Record<string, unknown> };
}

export const MAX_EXPORT_JOBS = 32;
const JOB_ID_PATTERN = /^cepexp-([0-9a-f]{12})-([0-9a-f]{16})$/;
let instanceId = randomBytes(6).toString("hex");
const jobs = new Map<string, ExportJobRecord>();

export function exportJobServerInstance(): string { return instanceId; }

/** Test hook: forget every job and optionally simulate a server restart. */
export function resetExportJobs(options: { simulateRestart?: boolean } = {}): void {
  jobs.clear();
  if (options.simulateRestart) instanceId = randomBytes(6).toString("hex");
}

/** Refuse before contacting Premiere when every slot holds an unfinished job. */
export function exportJobCapacityError(): string | null {
  if (jobs.size < MAX_EXPORT_JOBS) return null;
  for (const job of jobs.values()) if (job.terminal) return null;
  return `EXPORT_JOB_CAPACITY: ${MAX_EXPORT_JOBS} export jobs are still unfinished in this server process; poll get_export_job_status until some finish. Nothing was queued.`;
}

export function registerExportJob(input: Omit<ExportJobRecord, "id" | "startedAt">, now = Date.now()): ExportJobRecord {
  if (jobs.size >= MAX_EXPORT_JOBS) {
    const evictable = [...jobs.values()].find(job => job.terminal);
    // Oldest unfinished jobs are kept: evicting one would turn a live render into "unknown".
    if (!evictable) throw new Error(exportJobCapacityError() ?? "EXPORT_JOB_CAPACITY");
    jobs.delete(evictable.id);
  }
  const record: ExportJobRecord = { ...input, id: `cepexp-${instanceId}-${randomBytes(8).toString("hex")}`, startedAt: now };
  jobs.set(record.id, record);
  return record;
}

export type ExportJobLookup =
  | { found: true; job: ExportJobRecord }
  | { found: false; reason: "malformed_job_id" | "server_restarted" | "not_found_or_evicted"; message: string };

export function lookupExportJob(id: unknown): ExportJobLookup {
  const match = typeof id === "string" ? JOB_ID_PATTERN.exec(id) : null;
  if (!match) return { found: false, reason: "malformed_job_id", message: "job_id is not an export job id returned by export_sequence_job_start." };
  const job = jobs.get(id as string);
  if (job) return { found: true, job };
  if (match[1] !== instanceId) {
    return {
      found: false,
      reason: "server_restarted",
      message: "This job was started by an earlier or different MCP server process, so its state is unknown here. The render may still be running or finished in Adobe Media Encoder; check the output with verify_delivery_file before using it. Unknown is not success.",
    };
  }
  return {
    found: false,
    reason: "not_found_or_evicted",
    message: `No export job with this id is tracked by this server process (finished jobs are evicted after ${MAX_EXPORT_JOBS} newer ones). Unknown is not success.`,
  };
}
