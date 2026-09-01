import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/cep-reference-inventory.json", "utf8"));

describe("CEP and Premiere scripting reference inventory", () => {
  it("pins and accounts for every file without mixing authority classes", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.sources).toEqual([
      expect.objectContaining({
        repository: "Adobe-CEP/CEP-Resources",
        commit: "ab5e4e3e53a42fad08e1225a22a991bb1ffe73f6",
        authority: "adobe",
      }),
      expect.objectContaining({
        repository: "Adobe-CEP/Samples",
        commit: "e4946b73ac1e566dced8e95dba10811c31036927",
        authority: "adobe",
        pathPrefix: "PProPanel/",
      }),
      expect.objectContaining({
        repository: "docsforadobe/premiere-scripting-guide",
        commit: "4253cea094e84d43590b77012b33bd1c140f72ea",
        authority: "community",
      }),
    ]);
    expect(inventory.stats.total).toBe(inventory.entries.length);
    expect(Object.values(inventory.stats.byRepository).reduce((sum: number, count) => sum + Number(count), 0))
      .toBe(inventory.stats.total);
    expect(new Set(inventory.entries.map((entry: { repository: string; path: string }) => `${entry.repository}:${entry.path}`)).size)
      .toBe(inventory.entries.length);
  });

  it("retains exact blob identities and bounded categories", () => {
    const categories = new Set([
      "asset", "cep-runtime-library", "configuration", "documentation", "documentation-tooling",
      "sample", "signing-tool", "site-asset", "source",
    ]);
    for (const entry of inventory.entries) {
      expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.blobSha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.size).toBeGreaterThanOrEqual(0);
      expect(categories.has(entry.category)).toBe(true);
      expect(["adobe", "community"]).toContain(entry.authority);
      if (entry.repository === "Adobe-CEP/Samples") expect(entry.path).toMatch(/^PProPanel\//);
    }
    expect(inventory.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ repository: "Adobe-CEP/Samples", path: "PProPanel/ReadMe.md", category: "sample" }),
      expect.objectContaining({ repository: "docsforadobe/premiere-scripting-guide", authority: "community", category: "documentation" }),
    ]));
  });
});
