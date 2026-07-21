import { randomUUID } from "node:crypto";

export type AuditOutcome = "started" | "succeeded" | "denied" | "failed";

export interface AuditEvent {
  operationId: string;
  action: string;
  outcome: AuditOutcome;
  timestamp: string;
  details?: Record<string, unknown>;
}

export type AuditSink = (event: AuditEvent) => void;

export function createOperationId(): string {
  return randomUUID();
}

/** JSONL on stderr keeps the stdio protocol clean and gives operators correlation IDs. */
export const stderrAuditSink: AuditSink = (event) => {
  console.error(JSON.stringify({ type: "premiere-mcp-audit", ...event }));
};

export function emitAudit(
  sink: AuditSink,
  event: Omit<AuditEvent, "timestamp">,
): void {
  sink({ ...event, timestamp: new Date().toISOString() });
}
