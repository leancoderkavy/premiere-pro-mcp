import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeOptions, ensurePrivateBridgeDirectory, getTempDir } from "../bridge/file-bridge.js";

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^([0-9a-f]{64})\.([0-9a-f]{32})$/;
const TOKEN_FILE_PATTERN = /^edit-plan-token-[0-9a-f]{32}\.json$/;
const TOKEN_CLAIM_PATTERN = /^edit-plan-token-[0-9a-f]{32}\.claimed$/;

export interface EditPlanTokenStore {
  issue(planDigest: string): string;
  consume(token: string, planDigest: string): void;
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
    issue(planDigest) {
      ensureDirectory(directory);
      pruneExpiredTokens();
      const nonce = randomBytes(16).toString("hex");
      writeFileSync(fileFor(nonce), JSON.stringify({ planDigest, expiresAt: Date.now() + TOKEN_LIFETIME_MS }), { flag: "wx", mode: 0o600 });
      return `${planDigest}.${nonce}`;
    },
    consume(token, planDigest) {
      const match = TOKEN_PATTERN.exec(token);
      if (!match || match[1] !== planDigest) throw new Error("Confirmation token does not match this edit plan; preview it again");
      ensureDirectory(directory);
      let recorded: { planDigest?: string; expiresAt?: number };
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
    },
  };
}
