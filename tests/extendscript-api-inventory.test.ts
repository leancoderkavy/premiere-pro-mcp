import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(readFileSync("src/resources/extendscript-api-inventory.json", "utf8"));

function runFixture(markdown: string, referenceOverrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "extendscript-api-inventory-"));
  const sourcePath = "docs/example/example.md";
  const fixturePath = join(directory, sourcePath);
  mkdirSync(join(directory, "docs/example"), { recursive: true });
  writeFileSync(fixturePath, markdown);
  const referencePath = join(directory, "reference.json");
  writeFileSync(referencePath, JSON.stringify({ entries: [{
    repository: "docsforadobe/premiere-scripting-guide",
    commit: "4253cea094e84d43590b77012b33bd1c140f72ea",
    scope: "premiere-extendscript-guide",
    path: sourcePath,
    ...referenceOverrides,
  }] }));
  const outputPath = join(directory, "output.json");
  const result = spawnSync(process.execPath, ["scripts/generate-extendscript-api-inventory.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXTENDSCRIPT_INVENTORY_FIXTURE_DIRECTORY: directory,
      EXTENDSCRIPT_REFERENCE_PATH: referencePath,
      EXTENDSCRIPT_INVENTORY_OUTPUT_PATH: outputPath,
    },
  });
  return { directory, outputPath, result };
}

describe("Premiere ExtendScript API inventory", () => {
  it("pins a community source without inflating its authority", () => {
    expect(inventory.source).toMatchObject({
      repository: "docsforadobe/premiere-scripting-guide",
      commit: "4253cea094e84d43590b77012b33bd1c140f72ea",
      authority: "community",
    });
    expect(inventory.source.authorityNote).toContain("not Adobe API authority");
  });

  it("accounts for unique object members and representative APIs", () => {
    expect(inventory.stats.total).toBe(inventory.symbols.length);
    expect(inventory.stats.attributes + inventory.stats.methods).toBe(inventory.stats.total);
    expect(inventory.stats.objects).toBe(inventory.objects.length);
    expect(new Set(inventory.symbols.map((symbol: { object: string; kind: string; name: string }) =>
      `${symbol.object}:${symbol.kind}:${symbol.name}`)).size).toBe(inventory.symbols.length);
    expect(inventory.symbols).toEqual(expect.arrayContaining([
      expect.objectContaining({ object: "Application", name: "app.project", kind: "attribute", signature: "app.project" }),
      expect.objectContaining({ object: "Application", name: "app.openDocument()", kind: "method" }),
      expect.objectContaining({ object: "Sequence", name: "Sequence.importMGT()", kind: "method" }),
    ]));
  });

  it("executes the generator against a fixture page", () => {
    const fixture = runFixture("# Example object\n\n## Attributes\n\n### Example.value\n\n`app.value`\n\n## Methods\n\n### Example.run()\n\n`app.run(arg)`\n");
    try {
      expect(fixture.result.status).toBe(0);
      expect(JSON.parse(readFileSync(fixture.outputPath, "utf8")).symbols).toEqual([
        expect.objectContaining({ name: "Example.value", kind: "attribute", signature: "app.value" }),
        expect.objectContaining({ name: "Example.run()", kind: "method", signature: "app.run(arg)" }),
      ]);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("parses table-defined collection members without treating parameter tables as APIs", () => {
    const fixture = runFixture("# Collection object\n\n## Attributes\n\n| Attribute | Type |\n| --- | --- |\n| `length` | Integer |\n\n## Methods\n\n| Method | Return Type |\n| --- | --- |\n| `[]` | Object |\n");
    try {
      expect(fixture.result.status).toBe(0);
      expect(JSON.parse(readFileSync(fixture.outputPath, "utf8")).symbols).toEqual([
        expect.objectContaining({ name: "Collection.length", kind: "attribute", signature: "length" }),
        expect.objectContaining({ name: "Collection.[]", kind: "method", signature: "[]" }),
      ]);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing signature", "# Example object\n\n## Methods\n\n### Example.run()\n\nNo signature\n", "Missing inline signature"],
    ["duplicate member", "# Example object\n\n## Methods\n\n### Example.run()\n\n`app.run()`\n\n### Example.run()\n\n`app.run()`\n", "duplicate object members"],
    ["no symbols", "# Introduction\n\nNo object members.\n", "No ExtendScript symbols"],
  ])("fails closed for %s", (_label, markdown, expectedError) => {
    const fixture = runFixture(markdown);
    try {
      expect(fixture.result.status).not.toBe(0);
      expect(fixture.result.stderr).toContain(expectedError);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["commit", { commit: "0".repeat(40) }],
    ["scope", { scope: "wrong-scope" }],
  ])("fails closed for mismatched reference %s", (_label, overrides) => {
    const fixture = runFixture("# Example object\n\n## Attributes\n\n### Example.value\n\n`app.value`\n", overrides);
    try {
      expect(fixture.result.status).not.toBe(0);
      expect(fixture.result.stderr).toContain("do not match the pinned commit and scope");
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
