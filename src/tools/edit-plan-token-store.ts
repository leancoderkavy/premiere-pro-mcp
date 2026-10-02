import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeOptions, ensurePrivateBridgeDirectory, getTempDir } from "../bridge/file-bridge.js";

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = /^([0-9a-f]{64})\.([0-9a-f]{32})$/;

export interface EditPlanTokenStore {
  issue(planDigest: string): string;
  consume(token: string, planDigest: string): void;
}

/** Tokens live in the private bridge directory so process restarts cannot re-arm them. */
export function createEditPlanTokenStore(bridgeOptions: BridgeOptions): EditPlanTokenStore {
  const directory = getTempDir(bridgeOptions);
  function fileFor(nonce: string) {
    return join(directory, `edit-plan-token-${nonce}.json`);
  }
  return {
    issue(planDigest) {
      ensurePrivateBridgeDirectory(directory);
      const nonce = randomBytes(16).toString("hex");
      writeFileSync(fileFor(nonce), JSON.stringify({ planDigest, expiresAt: Date.now() + TOKEN_LIFETIME_MS }), { flag: "wx", mode: 0o600 });
      return `${planDigest}.${nonce}`;
    },
    consume(token, planDigest) {
      const match = TOKEN_PATTERN.exec(token);
      if (!match || match[1] !== planDigest) throw new Error("Confirmation token does not match this edit plan; preview it again");
      ensurePrivateBridgeDirectory(directory);
      let recorded: { planDigest?: string; expiresAt?: number };
      try {
        recorded = JSON.parse(readFileSync(fileFor(match[2]), "utf8")) as typeof recorded;
        // Unlink before any host mutation. Only one caller can successfully
        // unlink this file, including callers in different server processes.
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
