import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LandingDocumentRenderer,
  LandingDocumentTooLargeError,
  readBoundedUtf8,
  readLandingDocumentSettings,
} from "../src/landing-documents.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function settings(overrides: Partial<ReturnType<typeof readLandingDocumentSettings>> = {}) {
  return {
    maxConcurrentDocuments: 2,
    maxDocumentBytes: 1_024,
    maxCacheBytes: 4_096,
    ...overrides,
  };
}

describe("bounded landing document rendering", () => {
  it("reads no more than the byte limit even when the file is larger than its earlier stat", async () => {
    const directory = await mkdtemp(join(tmpdir(), "premiere-landing-"));
    temporaryDirectories.push(directory);
    const exact = join(directory, "exact.html");
    const oversized = join(directory, "oversized.html");
    await writeFile(exact, "12345678");
    await writeFile(oversized, "123456789");

    await expect(readBoundedUtf8(exact, 8)).resolves.toBe("12345678");
    await expect(readBoundedUtf8(oversized, 8)).rejects.toBeInstanceOf(LandingDocumentTooLargeError);
  });

  it("caches immutable source while applying per-response transforms before async gzip", async () => {
    const load = vi.fn(async () => "<html><script>boot()</script></html>");
    const renderer = new LandingDocumentRenderer(settings(), load);

    const first = await renderer.render("page.html", 36, (source) => source.replace("<script>", '<script nonce="first">'), true);
    const second = await renderer.render("page.html", 36, (source) => source.replace("<script>", '<script nonce="second">'), true);

    expect(first.accepted && gunzipSync(first.body).toString("utf8")).toContain('nonce="first"');
    expect(second.accepted && gunzipSync(second.body).toString("utf8")).toContain('nonce="second"');
    expect(load).toHaveBeenCalledOnce();
  });

  it("coalesces a cache miss without releasing either active work slot early", async () => {
    let finishLoad!: (document: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => { finishLoad = resolve; }));
    const renderer = new LandingDocumentRenderer(settings(), load);
    const first = renderer.render("page.html", 20, (source) => `${source}:first`, false);
    const second = renderer.render("page.html", 20, (source) => `${source}:second`, false);
    const rejected = await renderer.render("other.html", 20, (source) => source, false);

    expect(rejected).toEqual({ accepted: false });
    expect(load).toHaveBeenCalledOnce();
    finishLoad("source");
    await expect(first).resolves.toEqual({ accepted: true, body: "source:first" });
    await expect(second).resolves.toEqual({ accepted: true, body: "source:second" });
  });

  it("evicts least-recently-used source before exceeding the cache memory budget", async () => {
    const load = vi.fn(async (filePath: string) => filePath === "a.html" ? "aaaa" : "bbbb");
    const renderer = new LandingDocumentRenderer(settings({ maxCacheBytes: 8 }), load);

    await renderer.render("a.html", 4, (source) => source, false);
    await renderer.render("b.html", 4, (source) => source, false);
    await renderer.render("a.html", 4, (source) => source, false);

    expect(load).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized source before or after reading without retaining a failed load", async () => {
    const load = vi.fn(async () => "12345");
    const renderer = new LandingDocumentRenderer(settings({ maxDocumentBytes: 4 }), load);

    await expect(renderer.render("known.html", 5, (source) => source, false)).rejects.toBeInstanceOf(LandingDocumentTooLargeError);
    expect(load).not.toHaveBeenCalled();
    await expect(renderer.render("changed.html", undefined, (source) => source, false)).rejects.toBeInstanceOf(LandingDocumentTooLargeError);
    await expect(renderer.render("changed.html", undefined, (source) => source, false)).rejects.toBeInstanceOf(LandingDocumentTooLargeError);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails startup closed for malformed or inconsistent resource limits", () => {
    expect(readLandingDocumentSettings({})).toEqual({
      maxConcurrentDocuments: 4,
      maxDocumentBytes: 4 * 1024 * 1024,
      maxCacheBytes: 16 * 1024 * 1024,
    });
    expect(() => readLandingDocumentSettings({ MCP_MAX_CONCURRENT_LANDING_DOCUMENTS: "0" })).toThrow(/between 1 and 64/);
    expect(() => readLandingDocumentSettings({ MCP_LANDING_MAX_HTML_BYTES: "lots" })).toThrow(/must be an integer/);
    expect(() => readLandingDocumentSettings({
      MCP_LANDING_MAX_HTML_BYTES: "4096",
      MCP_LANDING_HTML_CACHE_BYTES: "2048",
    })).toThrow(/greater than or equal/);
  });
});
