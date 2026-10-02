import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/bridge/file-bridge.js")>();
  return { ...original, ensurePrivateBridgeDirectory: vi.fn() };
});

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

  it("allows exactly one of two concurrent server processes to consume a token", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "premiere-plan-race-"));
    directories.push(tempDir);
    const digest = "e".repeat(64);
    const token = createEditPlanTokenStore({ tempDir }).issue(digest);
    const source = resolve("src/tools/edit-plan-token-store.ts");
    const compiled = resolve("dist/tools/edit-plan-token-store.js");
    if (!existsSync(compiled) || statSync(compiled).mtimeMs < statSync(source).mtimeMs) {
      execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc")]);
    }
    const moduleUrl = pathToFileURL(compiled).href;
    const go = join(tempDir, "go");
    const script = `
      import { existsSync, writeFileSync } from "node:fs";
      const [moduleUrl, tempDir, token, digest, ready, go] = process.argv.slice(1);
      const { createEditPlanTokenStore } = await import(moduleUrl);
      writeFileSync(ready, "ready");
      while (!existsSync(go)) await new Promise((done) => setTimeout(done, 5));
      // Directory ACLs are covered separately; contend on the same real files
      // and exclusive claim primitive on every supported operating system.
      try { createEditPlanTokenStore({ tempDir }, { ensureDirectory: () => {} }).consume(token, digest); process.stdout.write("consumed"); }
      catch { process.stdout.write("rejected"); }
    `;
    const workers = [0, 1].map((index) => {
      const ready = join(tempDir, `ready-${index}`);
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, moduleUrl, tempDir, token, digest, ready, go], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      return { child, ready, result: new Promise<{ code: number | null; output: string }>((done) => child.on("close", (code) => done({ code, output }))) };
    });
    const deadline = Date.now() + 10_000;
    while (workers.some(({ ready }) => !existsSync(ready)) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 10));
    }
    if (!workers.every(({ ready }) => existsSync(ready))) {
      workers.forEach(({ child }) => child.kill());
      throw new Error("Token consumers did not reach the start barrier");
    }
    writeFileSync(go, "go");
    const outcomes = await Promise.all(workers.map(({ result }) => result));
    expect(outcomes.map(({ code }) => code)).toEqual([0, 0]);
    expect(outcomes.map(({ output }) => output).sort()).toEqual(["consumed", "rejected"]);
  }, 20_000);

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
    const claimPath = join(tempDir, `edit-plan-token-${expired.split(".")[1]}.claimed`);
    expect(existsSync(claimPath)).toBe(true);

    clock.mockReturnValue(issuedAt);
    const unused = store.issue(digest);
    const unusedPath = join(tempDir, `edit-plan-token-${unused.split(".")[1]}.json`);
    const oldTime = new Date(issuedAt - 31 * 60 * 1000);
    utimesSync(unusedPath, oldTime, oldTime);
    utimesSync(claimPath, oldTime, oldTime);
    store.issue(digest);
    expect(existsSync(unusedPath)).toBe(false);
    expect(existsSync(claimPath)).toBe(false);
  });
});
