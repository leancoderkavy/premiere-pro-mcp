import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/cep-reference-inventory.json", "utf8"));

const fixtureNames = [
  "Adobe-CEP__CEP-Resources.json",
  "Adobe-CEP__Samples.json",
  "docsforadobe__premiere-scripting-guide.json",
];

function runWithFixtures(overrides: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "cep-reference-inventory-"));
  const output = join(directory, "inventory.json");
  const validTrees = [
    { tree: [{ type: "blob", path: "CSInterface.js", sha: "a".repeat(40), size: 1 }] },
    { tree: [{ type: "blob", path: "PProPanel/ReadMe.md", sha: "b".repeat(40), size: 2 }] },
    { tree: [{ type: "blob", path: "docs/index.md", sha: "c".repeat(40), size: 3 }] },
  ];
  fixtureNames.forEach((name, index) => writeFileSync(join(directory, name), JSON.stringify(validTrees[index])));
  for (const [name, contents] of Object.entries(overrides)) writeFileSync(join(directory, name), contents);
  const result = spawnSync(process.execPath, ["scripts/generate-cep-reference-inventory.mjs"], {
    encoding: "utf8",
    env: { ...process.env, CEP_INVENTORY_FIXTURE_DIRECTORY: directory, CEP_INVENTORY_OUTPUT_PATH: output },
  });
  return { directory, output, result };
}

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

  it.each([
    ["malformed", "Adobe-CEP__CEP-Resources.json", "{", "SyntaxError"],
    ["empty", "Adobe-CEP__CEP-Resources.json", JSON.stringify({ tree: [] }), "No files matched"],
    ["truncated", "Adobe-CEP__CEP-Resources.json", JSON.stringify({ truncated: true, tree: [] }), "truncated tree"],
    ["invalid metadata", "Adobe-CEP__CEP-Resources.json", JSON.stringify({ tree: [{ type: "blob", path: "x.js", sha: "bad", size: 1 }] }), "Invalid Git blob metadata"],
    ["duplicate", "Adobe-CEP__CEP-Resources.json", JSON.stringify({ tree: [
      { type: "blob", path: "x.js", sha: "d".repeat(40), size: 1 },
      { type: "blob", path: "x.js", sha: "e".repeat(40), size: 2 },
    ] }), "duplicate repository paths"],
  ])("fails closed for a %s fixture tree", (_label, name, contents, expectedError) => {
    const { directory, result } = runWithFixtures({ [name]: contents });
    try {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expectedError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("executes the generator against fixtures and preserves classification boundaries", () => {
    const { directory, output, result } = runWithFixtures({});
    try {
      expect(result.status).toBe(0);
      const generated = JSON.parse(readFileSync(output, "utf8"));
      expect(generated.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "CSInterface.js", category: "cep-runtime-library", authority: "adobe" }),
        expect.objectContaining({ path: "PProPanel/ReadMe.md", category: "sample", authority: "adobe" }),
        expect.objectContaining({ path: "docs/index.md", category: "documentation", authority: "community" }),
      ]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
