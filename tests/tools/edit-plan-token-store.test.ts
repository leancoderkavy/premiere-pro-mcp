import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditPlanTokenStore } from "../../src/tools/edit-plan-token-store.js";

const directories: string[] = [];
afterEach(() => {
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
});
