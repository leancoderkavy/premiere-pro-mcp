import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getProjectTools({ tempDir: "/tmp/project-lifecycle", timeoutMs: 5000 } as BridgeOptions);
type Result = { success: boolean; error?: string; data?: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

type Seq = { name: string; sequenceID: string };
type Proj = {
  name: string; path: string; activeSequence: Seq | null;
  sequences: Record<string | number, unknown> & { numSequences: number };
  saveAs: (p: string) => void; closeDocument: () => boolean; openSequence: (id: string) => boolean;
};

/**
 * Live 25.2 behaviors: saveAs opens the copy and closes the original;
 * openDocument on an already-open project returns false and changes nothing;
 * openSequence brings its project to the front unless that timeline already
 * has focus (a new empty project keeps the previous project's timeline focused).
 */
function host(options: { saveAsNoop?: boolean; missingOutput?: boolean; emptyOutput?: boolean; missingParent?: boolean; modifiedUnavailable?: "before" | "after" | "both"; sameSizeRewrite?: boolean } = {}) {
  const files = new Map<string, { length: number; modified: number }>([
    ["/p/Main.prproj", { length: 100, modified: 1000 }],
    ["/p/Other.prproj", { length: 80, modified: 1000 }],
    ["/p/Backup.prproj", { length: 50, modified: 1000 }],
  ]);
  let saveCalls = 0;
  const state = { focusedSequence: "" };
  const open: Proj[] = [];
  const app: Record<string, unknown> = {};
  const makeProject = (path: string, sequenceNames: string[]): Proj => {
    const seqs = sequenceNames.map((name, i) => ({ name, sequenceID: `${path}#${i}` }));
    const project: Proj = {
      name: path.split("/").pop() as string,
      path,
      activeSequence: seqs[0] ?? null,
      sequences: Object.assign({ numSequences: seqs.length }, seqs),
      saveAs: (target: string) => {
        saveCalls++;
        if (options.saveAsNoop) return;
        if (options.missingOutput) { files.delete(target); return; }
        files.set(target, { length: options.emptyOutput ? 0 : options.sameSizeRewrite ? 50 : 120, modified: 1001 });
        const copy = makeProject(target, sequenceNames);
        open.splice(open.indexOf(project), 1, copy);
        app.project = copy;
      },
      closeDocument: () => {
        open.splice(open.indexOf(project), 1);
        if (app.project === project) app.project = open[0] ?? null;
        return true;
      },
      openSequence: (id: string) => {
        if (state.focusedSequence === id) return true;
        state.focusedSequence = id;
        app.project = project;
        project.activeSequence = seqs.find((s) => s.sequenceID === id) ?? null;
        return true;
      },
    };
    return project;
  };
  const main = makeProject("/p/Main.prproj", ["Edit", "Selects"]);
  const scratch = makeProject("/p/Other.prproj", []);
  open.push(main, scratch);
  state.focusedSequence = main.activeSequence!.sequenceID;
  app.project = scratch;
  app.projects = new Proxy({}, { get: (_t, k) => (k === "numProjects" ? open.length : open[Number(k)]) });
  app.openDocument = () => false;
  function File(this: { parent: { exists: boolean } }, path: string) {
    Object.defineProperties(this, {
      exists: { get: () => files.has(path) },
      length: { get: () => files.get(path)?.length ?? 0 },
      modified: { get: () => {
        if (options.modifiedUnavailable === "both" || options.modifiedUnavailable === (saveCalls ? "after" : "before")) throw new Error("timestamp unavailable");
        return new Date(files.get(path)?.modified ?? 0);
      } },
    });
    this.parent = { exists: !options.missingParent };
  }
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, File }))));
  return { app, open, main, saveCalls: () => saveCalls };
}

describe("project lifecycle tools", () => {
  it("brings an already-open project to the front even when its timeline kept focus", async () => {
    const { app, main } = host();
    const result = await tools.open_project.handler({ path: "/p/Main.prproj" }) as Result;
    expect(result).toMatchObject({
      success: true,
      data: { alreadyOpen: true, activatedVia: "openSequence:Selects>Edit", activeSequence: "Edit", verified: true },
    });
    expect(app.project).toBe(main);
  });

  it("reports that save_project_as switched Premiere to the copy", async () => {
    const { app } = host();
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    const result = await tools.save_project_as.handler({ path: "/p/Main copy.prproj" }) as Result;
    expect(result).toMatchObject({
      success: true,
      data: { activeProjectPath: "/p/Main copy.prproj", previousProjectPath: "/p/Main.prproj", previousProjectStillOpen: false, note: expect.stringContaining("later edits change the copy") },
    });
    expect((app.project as Proj).path).toBe("/p/Main copy.prproj");
    expect(result.data).toMatchObject({ saved: true, verified: true });
    await expect(tools.save_project_as.handler({ path: "/p/notes.txt" })).resolves.toMatchObject({ success: false });
  });

  it("fails when saveAs leaves a pre-existing project file unchanged", async () => {
    host({ saveAsNoop: true });
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("existing output was unchanged"),
    });
  });

  it("treats a rewritten pre-existing path as a verified Save As", async () => {
    const { app } = host();
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: true,
      data: { saved: true, verified: true, activeProjectPath: "/p/Backup.prproj" },
    });
    expect((app.project as Proj).path).toBe("/p/Backup.prproj");
  });

  it.each(["before", "after", "both"] as const)("refuses unchanged size when the %s timestamp is unreadable", async (modifiedUnavailable) => {
    host({ saveAsNoop: true, modifiedUnavailable });
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("timestamp is unreadable"),
    });
  });

  it("verifies same-size rewrites using millisecond timestamp precision", async () => {
    host({ sameSizeRewrite: true });
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: true, data: { saved: true, verified: true },
    });
  });

  it.each(["missingOutput", "emptyOutput"] as const)("refuses %s after Save As", async (option) => {
    host({ [option]: true });
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("non-empty project file"),
    });
  });

  it("refuses a missing parent before Save As", async () => {
    const h = host({ missingParent: true });
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.save_project_as.handler({ path: "/p/Backup.prproj" })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("directory does not exist"),
    });
    expect(h.saveCalls()).toBe(0);
  });

  it("closes a background project by path and leaves the active one alone", async () => {
    const { app, open } = host();
    await tools.open_project.handler({ path: "/p/Main.prproj" });
    await expect(tools.close_project.handler({ project_path: "/p/Other.prproj", save_first: false })).resolves.toMatchObject({
      success: true,
      data: { closed: true, verified: true, activeProjectPath: "/p/Main.prproj", openProjects: ["/p/Main.prproj"] },
    });
    expect(open).toHaveLength(1);
    expect((app.project as Proj).path).toBe("/p/Main.prproj");
    await expect(tools.close_project.handler({ project_path: "/p/Missing.prproj" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("No open project") });
  });

  it("fails honestly for a missing project file", async () => {
    host();
    await expect(tools.open_project.handler({ path: "/p/Nope.prproj" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("not found") });
  });
});

describe("import_fcp_xml", () => {
  /** Live 25.2: openFCPXML opens <tmp>/<xml name>.prproj and leaves an empty FOLDER at project_path. */
  function xmlHost(options: { opens?: boolean; importsTo?: string; existing?: string[]; macTemp?: boolean } = {}) {
    const importsTo = options.importsTo ?? "/tmp/T/cut.prproj";
    const files = new Set(["/p/cut.xml", ...(options.existing ?? [])]);
    const folders = new Set<string>();
    const open: Array<Record<string, unknown>> = [{ path: "/p/Main.prproj", sequences: { numSequences: 0 } }];
    const seq = { name: "B3c Cut", sequenceID: "s1", videoTracks: { numTracks: 1, 0: { clips: { numItems: 4 } } }, audioTracks: { numTracks: 1, 0: { clips: { numItems: 4 } } } };
    const app = {
      project: open[0],
      projects: new Proxy({}, { get: (_t, k) => (k === "numProjects" ? open.length : open[Number(k)]) }),
      openFCPXML: (_xml: string, dest: string) => {
        folders.add(dest);
        if (options.opens === false) return;
        files.add(importsTo);
        const imported: Record<string, unknown> = { path: importsTo, sequences: { numSequences: 1, 0: seq } };
        imported.saveAs = (target: string) => { if (folders.has(target)) throw new Error("is a folder"); files.add(target); imported.path = target; };
        open.push(imported);
      },
    };
    function File(this: { exists: boolean; remove: () => boolean }, path: string) {
      this.exists = files.has(path) || folders.has(path);
      this.remove = () => files.delete(path);
    }
    // ExtendScript: new Folder(file).exists is true for a file too; Folder(path) without new returns a File for a file.
    function Folder(this: { exists: boolean; getFiles: () => unknown[]; remove: () => boolean } | undefined, path: string): unknown {
      if (!(this instanceof Folder)) {
        return files.has(path) && !folders.has(path)
          ? new (File as unknown as new (p: string) => unknown)(path)
          : new (Folder as unknown as new (p: string) => unknown)(path);
      }
      const bare = path.replace(/^\/private\//, "/");
      this.exists = folders.has(path) || files.has(path) || [...files].some((f) => f.startsWith(`${path}/`) || f.startsWith(`${bare}/`));
      this.getFiles = () => listProjects(bare);
      this.remove = () => folders.delete(path);
      return this;
    }
    // Folder.getFiles(): the folder's own entries (no recursion).
    const listProjects = (root: string) => [...files].filter((p) => p.startsWith(`${root}/`) && !p.slice(root.length + 1).includes("/")).map((fsName) => ({ fsName }));
    // Live 25.2.3 (macOS): Folder.temp is ".../T/TemporaryItems" under /private/var,
    // while Premiere writes the intermediate project to $TMPDIR (".../T/", under /var).
    (Folder as unknown as { temp: unknown }).temp = options.macTemp
      ? { fsName: "/private/var/T/TemporaryItems", fullName: "/private/var/T/TemporaryItems", parent: { fsName: "/private/var/T" }, exists: true }
      : { fsName: "/tmp/T", fullName: "/tmp/T", exists: true };
    const $ = { getenv: (name: string) => (options.macTemp && name === "TMPDIR" ? "/var/T/" : "") };
    mockedSendCommand.mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, File, Folder, $ }))));
    return { files, folders };
  }

  it("saves the temp-folder import to project_path and lists its sequences", async () => {
    const { files, folders } = xmlHost();
    const result = await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" }) as Result;
    expect(result).toMatchObject({
      success: true,
      data: { verified: true, projectPath: "/p/From XML.prproj", sequences: [{ name: "B3c Cut", clipCount: 8 }], activeProjectPath: "/p/Main.prproj" },
    });
    expect(files.has("/p/From XML.prproj")).toBe(true);
    expect(folders.has("/p/From XML.prproj")).toBe(false);
    expect(result.data).toMatchObject({ intermediateRemoved: true, intermediateKeptAt: null });
    expect(files.has("/tmp/T/cut.prproj")).toBe(false);
  });

  it("never deletes an intermediate project outside the temp or destination folder", async () => {
    const { files } = xmlHost({ importsTo: "/Users/me/Projects/cut.prproj" });
    const result = await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" }) as Result;
    expect(result).toMatchObject({ success: true, data: { intermediateRemoved: false, intermediateKeptAt: "/Users/me/Projects/cut.prproj" } });
    expect(files.has("/Users/me/Projects/cut.prproj")).toBe(true);
  });

  it("never deletes a project that was already in the temp folder before the import", async () => {
    const { files } = xmlHost({ existing: ["/tmp/T/cut.prproj"] });
    const result = await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" }) as Result;
    expect(result).toMatchObject({ success: true, data: { intermediateRemoved: false, intermediateKeptAt: "/tmp/T/cut.prproj" } });
    expect(files.has("/tmp/T/cut.prproj")).toBe(true);
  });

  it("never deletes a project in a subfolder of the temp folder, which the snapshot does not list", async () => {
    const { files } = xmlHost({ importsTo: "/tmp/T/older/cut.prproj", existing: ["/tmp/T/older/cut.prproj"] });
    const result = await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" }) as Result;
    expect(result).toMatchObject({ success: true, data: { intermediateRemoved: false, intermediateKeptAt: "/tmp/T/older/cut.prproj" } });
    expect(files.has("/tmp/T/older/cut.prproj")).toBe(true);
  });

  it("recognises an existing project whose extension is upper case", async () => {
    const { files } = xmlHost({ importsTo: "/tmp/T/CUT.PRPROJ", existing: ["/tmp/T/CUT.PRPROJ"] });
    await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" });
    expect(files.has("/tmp/T/CUT.PRPROJ")).toBe(true);
  });

  it("deletes the intermediate project Premiere wrote to $TMPDIR on macOS (not Folder.temp)", async () => {
    const { files } = xmlHost({ macTemp: true, importsTo: "/var/T/lv.prproj" });
    const result = await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" }) as Result;
    expect(result).toMatchObject({ success: true, data: { intermediateRemoved: true, intermediateKeptAt: null } });
    expect(files.has("/var/T/lv.prproj")).toBe(false);
  });

  it("keeps a same-named project that already existed in $TMPDIR", async () => {
    const { files } = xmlHost({ macTemp: true, importsTo: "/var/T/lv.prproj", existing: ["/var/T/lv.prproj"] });
    await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" });
    expect(files.has("/var/T/lv.prproj")).toBe(true);
  });

  it("does not treat a lookalike folder as the temp folder", async () => {
    const { files } = xmlHost({ importsTo: "/tmp/T-other/cut.prproj" });
    await tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" });
    expect(files.has("/tmp/T-other/cut.prproj")).toBe(true);
  });

  it("fails when Premiere opens nothing", async () => {
    xmlHost({ opens: false });
    await expect(tools.import_fcp_xml.handler({ path: "/p/cut.xml", project_path: "/p/From XML.prproj" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("opened no new project") });
  });
});
