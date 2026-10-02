import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeOptions, ensurePrivateBridgeDirectory, getTempDir } from "../bridge/file-bridge.js";

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^([0-9a-f]{64})\.([0-9a-f]{32})$/;
const TOKEN_FILE_PATTERN = /^edit-plan-token-[0-9a-f]{32}\.json$/;
const TOKEN_CLAIM_PATTERN = /^edit-plan-token-[0-9a-f]{32}\.claimed$/;

export type EditPlanHostTarget =
  | { type: "insert_clip"; targetId: string; videoTrackIndex: number; audioTrackIndex: number }
  | { type: "remove_clip"; targetId: string; sourceProjectItemId: string; trackType: "video" | "audio"; trackIndex: number; startTicks: string; endTicks: string };
export interface EditPlanHostBinding {
  version: 1;
  projectDocumentId: string;
  sequenceId: string;
  targets: EditPlanHostTarget[];
}

/** Missing legacy context must require a fresh host preview, never a test fallback. */
export function validateEditPlanHostBinding(value: unknown): EditPlanHostBinding {
  const fail = () => { throw new Error("Confirmation token has no valid host-target binding; preview the edit again"); };
  if (!value || typeof value !== "object") return fail();
  const binding = value as EditPlanHostBinding;
  const identity = (id: unknown) => typeof id === "string" && id.trim().length > 0;
  const index = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (binding.version !== 1 || !identity(binding.projectDocumentId) || !identity(binding.sequenceId) || !Array.isArray(binding.targets) || !binding.targets.length || binding.targets.length > 100) return fail();
  const targets = binding.targets.map((target): EditPlanHostTarget => {
    if (!target || !identity(target.targetId)) return fail();
    if (target.type === "insert_clip" && index(target.videoTrackIndex) && index(target.audioTrackIndex)) {
      return { type: target.type, targetId: target.targetId, videoTrackIndex: target.videoTrackIndex, audioTrackIndex: target.audioTrackIndex };
    }
    if (target.type === "remove_clip" && identity(target.sourceProjectItemId) && (target.trackType === "video" || target.trackType === "audio") && index(target.trackIndex) && identity(target.startTicks) && identity(target.endTicks)) {
      return { type: target.type, targetId: target.targetId, sourceProjectItemId: target.sourceProjectItemId, trackType: target.trackType, trackIndex: target.trackIndex, startTicks: target.startTicks, endTicks: target.endTicks };
    }
    return fail();
  });
  return { version: 1, projectDocumentId: binding.projectDocumentId, sequenceId: binding.sequenceId, targets };
}

export interface EditPlanTokenStore {
  issue(planDigest: string, binding: EditPlanHostBinding): string;
  consume(token: string, planDigest: string): EditPlanHostBinding;
}

/** Tokens live in the private bridge directory so process restarts cannot re-arm them. */
export function createEditPlanTokenStore(
  bridgeOptions: BridgeOptions,
  dependencies: { ensureDirectory?: (directory: string) => void } = {},
): EditPlanTokenStore {
  const directory = getTempDir(bridgeOptions);
  const ensureDirectory = (path: string) => (dependencies.ensureDirectory ?? ensurePrivateBridgeDirectory)(path);
  function fileFor(nonce: string) {
    return join(directory, `edit-plan-token-${nonce}.json`);
  }
  function pruneExpiredTokens() {
    const cutoff = Date.now() - TOKEN_LIFETIME_MS;
    for (const name of readdirSync(directory)) {
      if (!TOKEN_FILE_PATTERN.test(name) && !TOKEN_CLAIM_PATTERN.test(name)) continue;
      const path = join(directory, name);
      try {
        const stat = lstatSync(path);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) unlinkSync(path);
        if (stat.isDirectory() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) rmdirSync(path);
      } catch {
        // Another server may have consumed the file during this scan.
      }
    }
  }
  return {
    issue(planDigest, binding) {
      const hostBinding = validateEditPlanHostBinding(binding);
      ensureDirectory(directory);
      pruneExpiredTokens();
      const nonce = randomBytes(16).toString("hex");
      writeFileSync(fileFor(nonce), JSON.stringify({ planDigest, hostBinding, expiresAt: Date.now() + TOKEN_LIFETIME_MS }), { flag: "wx", mode: 0o600 });
      return `${planDigest}.${nonce}`;
    },
    consume(token, planDigest) {
      const match = TOKEN_PATTERN.exec(token);
      if (!match || match[1] !== planDigest) throw new Error("Confirmation token does not match this edit plan; preview it again");
      ensureDirectory(directory);
      let recorded: { planDigest?: string; expiresAt?: number; hostBinding?: unknown };
      try {
        recorded = JSON.parse(readFileSync(fileFor(match[2]), "utf8")) as typeof recorded;
        // Exclusive directory creation is the cross-process claim. Keep the
        // tombstone until expiry even if deletion or the host edit fails.
        mkdirSync(join(directory, `edit-plan-token-${match[2]}.claimed`), { mode: 0o700 });
        unlinkSync(fileFor(match[2]));
      } catch {
        throw new Error("This confirmation token is missing or already consumed; preview the edit again");
      }
      if (recorded.planDigest !== planDigest || typeof recorded.expiresAt !== "number" || recorded.expiresAt < Date.now()) {
        throw new Error("This confirmation token is invalid or expired; preview the edit again");
      }
      return validateEditPlanHostBinding(recorded.hostBinding);
    },
  };
}
