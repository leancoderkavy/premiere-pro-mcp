import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditPlanTokenStore } from "../../src/tools/edit-plan-token-store.js";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("single-use edit-plan confirmation tokens", () => {
  it("requires preview issuance and rejects replay across server instances", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "premiere-plan-token-"));
    directories.push(tempDir);
    const digest = "a".repeat(64);
    const firstServer = createEditPlanTokenStore({ tempDir });
    const restartedServer = createEditPlanTokenStore({ tempDir });

    expect(() => firstServer.consume(`${digest}.${"b".repeat(32)}`, digest)).toThrow("missing or already consumed");
    const token = firstServer.issue(digest);
    expect(token).not.toBe(digest);
    expect(() => restartedServer.consume(token, "c".repeat(64))).toThrow("does not match");
    expect(() => restartedServer.consume(token, digest)).not.toThrow();
    expect(() => firstServer.consume(token, digest)).toThrow("missing or already consumed");

    const fresh = restartedServer.issue(digest);
    expect(fresh).not.toBe(token);
    expect(() => firstServer.consume(fresh, digest)).not.toThrow();
  });

  it("rejects expired tokens and prunes unused expired previews", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "premiere-plan-expiry-"));
    directories.push(tempDir);
    const digest = "d".repeat(64);
    const store = createEditPlanTokenStore({ tempDir });
    const issuedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(issuedAt);
    const stillValid = store.issue(digest);
    const expired = store.issue(digest);
    clock.mockReturnValue(issuedAt + 30 * 60 * 1000 - 1);
    expect(() => store.consume(stillValid, digest)).not.toThrow();
    clock.mockReturnValue(issuedAt + 31 * 60 * 1000);
    expect(() => store.consume(expired, digest)).toThrow("invalid or expired");
    expect(() => store.consume(expired, digest)).toThrow("missing or already consumed");

    clock.mockReturnValue(issuedAt);
    const unused = store.issue(digest);
    const unusedPath = join(tempDir, `edit-plan-token-${unused.split(".")[1]}.json`);
    const oldTime = new Date(issuedAt - 31 * 60 * 1000);
    utimesSync(unusedPath, oldTime, oldTime);
    store.issue(digest);
    expect(existsSync(unusedPath)).toBe(false);
  });
});
