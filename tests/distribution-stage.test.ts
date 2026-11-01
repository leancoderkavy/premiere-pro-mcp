import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Distribution tooling is JavaScript executed directly by Node.
import { validateClaudeStage } from "../scripts/validate-distribution.mjs";

const stages: string[] = [];
async function createStage() {
  const stage = await mkdtemp(path.join(tmpdir(), "mcpb-stage-test-"));
  stages.push(stage);
  const manifest = JSON.parse(await readFile("claude-desktop/manifest.json", "utf8"));
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const identity = { name: pkg.name, version: pkg.version, type: pkg.type, engines: pkg.engines };
  await mkdir(path.join(stage, "server", "dist"), { recursive: true });
  await writeFile(path.join(stage, "server", "dist", "index.js"), "");
  await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(stage, "package.json"), JSON.stringify(identity));
  return { stage, identity };
}

afterEach(async () => {
  await Promise.all(stages.splice(0).map((stage) => rm(stage, { recursive: true, force: true })));
});

describe("Claude bundle runtime identity", () => {
  it("rejects the previously released layout missing the runtime package metadata", async () => {
    const { stage } = await createStage();
    await expect(validateClaudeStage(stage)).rejects.toThrow(path.join("server", "package.json"));
  });

  it("rejects a runtime version that differs from the extension manifest", async () => {
    const { stage, identity } = await createStage();
    await writeFile(path.join(stage, "server", "package.json"), JSON.stringify({ ...identity, version: "0.0.0" }));
    await expect(validateClaudeStage(stage)).rejects.toThrow("runtime package identity");
  });

  it("accepts matching metadata at the compiled server's relative import location", async () => {
    const { stage, identity } = await createStage();
    await writeFile(path.join(stage, "server", "package.json"), JSON.stringify(identity));
    await expect(validateClaudeStage(stage)).resolves.toMatchObject({ packageJson: identity });
  });
});
