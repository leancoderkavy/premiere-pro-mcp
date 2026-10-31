import { createContext, runInContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

export interface RefusalHostOptions {
  folderExists?: unknown;
  folderThrows?: boolean;
  unreadableIndex?: boolean;
  unreadableAfterStep?: boolean;
  jumpOnStep?: boolean;
  newProject?: "normal" | "ignore" | "throw" | "change_then_throw";
}

export function refusalHost(options: RefusalHostOptions = {}) {
  let index = 91;
  let undoCalls = 0, redoCalls = 0, newProjectCalls = 0;
  const item = { nodeId: "item-1", name: "Original", type: 1, isSequence: () => false };
  function project(path: string) {
    return {
      path, name: "Fixture", documentID: "project-1", activeSequence: null,
      sequences: { numSequences: 0 }, rootItem: { children: { numItems: 1, 0: item } },
    };
  }
  const app = {
    project: project("/fixture/original.prproj"), enableQE() {},
    newProject(path: string) {
      newProjectCalls++;
      if (options.newProject === "throw") throw new Error("host create failed");
      if (options.newProject === "ignore") return;
      app.project = project(path);
      if (options.newProject === "change_then_throw") throw new Error("host changed then failed");
    },
  };
  class HostFile {
    fsName: string;
    constructor(path: string) { this.fsName = path; }
    get parent() {
      if (options.folderThrows) throw new Error("folder unreadable");
      return { exists: "folderExists" in options ? options.folderExists : true };
    }
  }
  const context = createContext({
    app, File: HostFile, $: { os: "Macintosh", global: {} },
    qe: { project: {
      undoStackIndex() {
        if (options.unreadableIndex || (options.unreadableAfterStep && undoCalls + redoCalls > 0)) throw new Error("stack unreadable");
        return index;
      },
      undo() { undoCalls++; index -= options.jumpOnStep ? 2 : 1; },
      redo() { redoCalls++; index += options.jumpOnStep ? 2 : 1; },
    } },
  });
  runInContext(getHelpersSource(), context);
  return {
    app, item,
    run(script: string) {
      parse(script, { ecmaVersion: 3, allowReserved: "never" });
      return JSON.parse(String(runInContext(script, context)));
    },
    get undoCalls() { return undoCalls; },
    get redoCalls() { return redoCalls; },
    get newProjectCalls() { return newProjectCalls; },
  };
}
