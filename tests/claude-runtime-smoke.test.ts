import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Distribution tooling is JavaScript executed directly by Node.
import { verifyClaudeRuntime } from "../scripts/verify-claude-runtime.mjs";

let stage: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (stage) await rm(stage, { recursive: true, force: true });
});

it("discovers diagnostics despite restricted parent client settings without changing those settings", async () => {
  stage = await mkdtemp(path.join(tmpdir(), "mcpb-runtime-settings-test-"));
  await mkdir(path.join(stage, "server", "dist"), { recursive: true });
  await writeFile(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));
  // Exercise the real compiled CLI and MCP server. The wrapper supplies the
  // staged entry location without duplicating the distribution's dependencies.
  const entry = pathToFileURL(path.resolve("dist/index.js")).href;
  await writeFile(path.join(stage, "server", "dist", "index.js"), `import ${JSON.stringify(entry)};\n`);
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  vi.stubEnv("PREMIERE_MCP_TOOL_PACKS", "captions");
  vi.stubEnv("PREMIERE_MCP_CAPABILITIES", "filesystem");

  await expect(verifyClaudeRuntime(stage, pkg.version)).resolves.toBeUndefined();
  expect(process.env.PREMIERE_MCP_TOOL_PACKS).toBe("captions");
  expect(process.env.PREMIERE_MCP_CAPABILITIES).toBe("filesystem");
}, 60_000);
