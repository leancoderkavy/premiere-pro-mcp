import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { gzipSync } from "node:zlib";
import { decodeExportPresetContents } from "../../src/tools/export.js";
import { readBoundedRegularFile } from "../../src/security/file-safety.js";
import { getMogrtStudioTools } from "../../src/tools/mogrt-studio.js";
import { buildMogrtPlan } from "../../src/tools/mogrt-authoring.js";

const base = mkdtempSync(join(tmpdir(), "file-safety-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("bounded regular file reads", () => {
  it("reads exact UTF-8 bytes including quotes and diacritics and refuses oversize files and directories", () => {
    const file = join(base, "ẹ̀ṣọ́ 'quoted'.xml");
    const bytes = Buffer.from("ẹ̀ṣọ́ ' \\\"");
    writeFileSync(file, bytes);
    expect(readBoundedRegularFile(file, bytes.length)).toEqual(bytes);
    expect(() => readBoundedRegularFile(file, bytes.length - 1)).toThrow(/at most/);
    expect(() => readBoundedRegularFile(base, 100)).toThrow(/regular file/);
  });
  it("rejects a compressed preset whose expanded bytes exceed its budget", () => {
    const compressed = gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    expect(() => decodeExportPresetContents(compressed)).toThrow(/expands beyond/);
  });
  it.skipIf(process.platform === "win32")("refuses a named FIFO promptly without a writer", () => {
    const fifo = join(base, "pipe.xml");
    execFileSync("mkfifo", [fifo]);
    const compiled = ts.transpileModule(readFileSync("src/security/file-safety.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modulePath = join(base, "reader.mjs");
    writeFileSync(modulePath, compiled);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {readBoundedRegularFile} from ${JSON.stringify(`file://${modulePath}`)};try{readBoundedRegularFile(${JSON.stringify(fifo)},100);process.exit(2)}catch{process.exit(0)}`], { timeout: 3000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});

describe("workspace-contained template paths", () => {
  const workspace = join(base, "workspace"), outside = join(base, "outside"), linked = join(workspace, "linked");
  mkdirSync(workspace); mkdirSync(outside);
  writeFileSync(join(workspace, "title.mogrt"), "PK\x03\x04");
  symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
  const tools = getMogrtStudioTools({ tempDir: join(base, "bridge") }, { artifactStatus: () => ({ exists: true, size_bytes: 4, zip_header_valid: true }) });
  it("refuses an existing linked library before previewing publication", async () => {
    await expect(tools.preview_mogrt_library_publish.handler({ approved_workspace_path: workspace, mogrt_path: join(workspace, "title.mogrt"), library_directory: linked, template_name: "Title" })).rejects.toThrow(/symbolic link|junction/);
  });
  it("rechecks a previewed destination before creating any library version", async () => {
    const library = join(workspace, "library"); mkdirSync(library);
    const preview = await tools.preview_mogrt_library_publish.handler({ approved_workspace_path: workspace, mogrt_path: join(workspace, "title.mogrt"), library_directory: library, template_name: "Title" });
    rmSync(library, { recursive: true }); symlinkSync(outside, library, process.platform === "win32" ? "junction" : "dir");
    await expect(tools.publish_mogrt_to_library.handler({ preview_token: preview.data.previewToken, confirm_publish: true })).rejects.toThrow(/symbolic link|junction/);
    expect(() => readFileSync(join(outside, "Title", "v001", "Title.mogrt"))).toThrow();
  });
  it("refuses authoring through a linked output directory before host dispatch", () => {
    expect(() => buildMogrtPlan({ approved_workspace_path: workspace, output_directory: linked, recipe: "title_card", template_name: "Title", headline: "ẹ̀ṣọ́" }, () => true)).toThrow(/symbolic link|junction/);
  });
});
