/** Shared QE bridge-call bound for native ExtendScript stack safety. */
export const QE_BATCH_SIZE_ENV = "PREMIERE_MCP_QE_BATCH_SIZE";
export const DEFAULT_QE_BATCH_SIZE = 8;
export const MIN_QE_BATCH_SIZE = 1;
export const MAX_QE_BATCH_SIZE = 32;

export function resolveQeBatchSize(override?: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[QE_BATCH_SIZE_ENV];
  const requested = override ?? (raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw));
  if (!Number.isFinite(requested)) return DEFAULT_QE_BATCH_SIZE;
  return Math.min(MAX_QE_BATCH_SIZE, Math.max(MIN_QE_BATCH_SIZE, Math.floor(requested)));
}
