import { beforeEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { parse } from "acorn";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), withBridgeWorkflow: (_o: unknown, work: () => unknown) => work() }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getMogrtStudioTools } from "../../src/tools/mogrt-studio.js";
import { getAfterEffectsHelpersSource } from "../../src/bridge/after-effects-script-builder.js";
import { capabilitiesForToolInvocation, resolveCapabilities, toolMayChangeState } from "../../src/security/capabilities.js";

const mockedSendCommand = vi.mocked(sendCommand);
beforeEach(() => vi.clearAllMocks());

// Live (Premiere 26.5.2): a Dynamic Link import names the item "<comp>/<file>.aep".
describe("import_ae_comps returns the new items", () => {
  function host(names: string[], options: { unreadableItems?: boolean } = {}) {
    const aep = "/work/motion.aep";
    const children: Array<{ nodeId: string; name: string; getMediaPath: () => string }> = [{ nodeId: "old-1", name: "Existing", getMediaPath: () => "/media/a.mp4" }];
    const bin = { children: new Proxy(children, { get: (array, key) => {
      if (key === "numItems") return array.length;
      if (options.unreadableItems && typeof key === "string" && /^\d+$/.test(key)) throw new Error("item unreadable");
      return Reflect.get(array, key);
    } }) };
    function File(this: { fsName: string; exists: boolean }, name: string) { this.fsName = name; this.exists = true; }
    const importAll = vi.fn(() => { names.forEach((name, i) => children.push({ nodeId: `new-${i}`, name, getMediaPath: () => aep })); });
    mockedSendCommand.mockImplementation(async (script) => {
      parse(script, { ecmaVersion: 3, allowReserved: "never", allowReturnOutsideFunction: true });
      return JSON.parse(String(vm.runInNewContext(script, {
        File, __findProjectItem: () => bin,
        __result: (data: unknown) => JSON.stringify({ success: true, data }),
        __error: (error: string) => JSON.stringify({ success: false, error }),
        app: { project: { rootItem: bin, importAEComps: importAll, importAllAEComps: importAll } },
      })));
    });
    return { tools: getProjectTools({ tempDir: "/tmp/ae-import", timeoutMs: 1000 }), importAll };
  }

  it("returns each new item's node ID and verifies requested comps by name and source", async () => {
    const { tools } = host(["Lower Third/motion.aep"]);
    const result = await tools.import_ae_comps.handler({ ae_project_path: "/work/motion.aep", comp_names: ["Lower Third"] }) as any;
    expect(result).toMatchObject({ success: true, data: { verified: true, outcome: "verified", items: [{ nodeId: "new-0", name: "Lower Third/motion.aep", fromProject: true }] } });
  });

  it("stays committed_unverified when a requested comp is not among the new items", async () => {
    const { tools } = host(["Something Else/motion.aep"]);
    const result = await tools.import_ae_comps.handler({ ae_project_path: "/work/motion.aep", comp_names: ["Lower Third"] }) as any;
    expect(result).toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified" } });
    expect(result.data.items).toHaveLength(1);
  });

  it("refuses a named import before calling Premiere when the bin's items cannot be read", async () => {
    const { tools, importAll } = host(["Lower Third/motion.aep"], { unreadableItems: true });
    const result = await tools.import_ae_comps.handler({ ae_project_path: "/work/motion.aep", comp_names: ["Lower Third"] }) as any;
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("No compositions were imported");
    expect(importAll).not.toHaveBeenCalled();
  });

  it("keeps an all-comps import on the count check without items when the bin's items cannot be read", async () => {
    const { tools, importAll } = host(["Lower Third/motion.aep"], { unreadableItems: true });
    const result = await tools.import_ae_comps.handler({ ae_project_path: "/work/motion.aep" }) as any;
    expect(importAll).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: { verified: true, allComps: true, addedItems: 1 } });
    expect(result.data.outcome).toBeUndefined();
    expect(result.data.items).toBeUndefined();
  });

  it("lists the new items as information on an all-comps import", async () => {
    const { tools } = host(["Lower Third/motion.aep", "Title/motion.aep"]);
    const result = await tools.import_ae_comps.handler({ ae_project_path: "/work/motion.aep" }) as any;
    expect(result).toMatchObject({ success: true, data: { verified: true, allComps: true, addedItems: 2, verificationScope: "Target-bin item-count increase only; composition identity and rendered content are not verified." } });
    expect(result.data.items.map((item: { name: string }) => item.name)).toEqual(["Lower Third/motion.aep", "Title/motion.aep"]);
  });
});

// Live (AE 26.5): template names are only readable through a render-queue item.
describe("inspect_after_effects_render_templates on an empty queue", () => {
  function studio(options: { queued?: number; removeFails?: boolean } = {}) {
    const queue: unknown[] = Array.from({ length: options.queued ?? 0 }, () => ({}));
    const templates = { rs: ["Best Settings", "Draft Settings"], om: ["High Quality", "Lossless"] };
    function CompItem(this: { name: string }, name: string) { this.name = name; }
    const items = [new (CompItem as any)("Lower Third")];
    const renderQueue = {
      rendering: false,
      get numItems() { return queue.length; },
      item: () => ({ templates: templates.rs, outputModule: () => ({ templates: templates.om }) }),
      items: { add: () => { const entry = { templates: templates.rs, outputModule: () => ({ templates: templates.om }), remove: () => { if (options.removeFails) throw new Error("locked"); queue.pop(); } }; queue.push(entry); return entry; } },
    };
    const sendAfterEffects = vi.fn(async (script: string) => {
      parse(script, { ecmaVersion: 3, allowReserved: "never" });
      return JSON.parse(String(vm.runInNewContext(`${getAfterEffectsHelpersSource()}\n${script}`, { CompItem, app: { project: { renderQueue, numItems: items.length, item: (i: number) => items[i - 1] } } })));
    });
    const tools = getMogrtStudioTools({ tempDir: "/tmp/ae-templates", timeoutMs: 1000 }, { capabilities: resolveCapabilities(), sendAfterEffects });
    return { tools, queue };
  }

  it("refuses on an empty queue unless the temporary item is allowed", async () => {
    const { tools } = studio();
    const result = await tools.inspect_after_effects_render_templates.handler({}) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("allow_temporary_queue_item");
  });

  it("reads template names through a temporary item and restores the queue", async () => {
    const { tools, queue } = studio();
    const result = await tools.inspect_after_effects_render_templates.handler({ allow_temporary_queue_item: true }) as any;
    expect(result).toMatchObject({ success: true, data: { temporaryQueueItem: true, temporaryComposition: "Lower Third", queueLengthRestored: true } });
    // Host arrays from this test realm serialise as indexed objects; compare values.
    expect(Object.values(result.data.renderSettingsTemplates)).toEqual(["Best Settings", "Draft Settings"]);
    expect(Object.values(result.data.outputModuleTemplates)).toEqual(["High Quality", "Lossless"]);
    expect(queue).toHaveLength(0);
  });

  it("stays read-only when a queue item already exists", async () => {
    const { tools, queue } = studio({ queued: 1 });
    const result = await tools.inspect_after_effects_render_templates.handler({ allow_temporary_queue_item: true }) as any;
    expect(result).toMatchObject({ success: true, data: { readOnly: true, temporaryQueueItem: false } });
    expect(queue).toHaveLength(1);
  });

  it("asks for manual cleanup when the temporary item cannot be removed", async () => {
    const { tools } = studio({ removeFails: true });
    const result = await tools.inspect_after_effects_render_templates.handler({ allow_temporary_queue_item: true }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("Remove it from the render queue manually");
  });

  it("names a missing composition and validates the options", async () => {
    const { tools } = studio();
    expect(await tools.inspect_after_effects_render_templates.handler({ allow_temporary_queue_item: true, composition_name: "Nope" })).toMatchObject({ success: false, error: expect.stringContaining("No composition named Nope") });
    expect(await tools.inspect_after_effects_render_templates.handler({ allow_temporary_queue_item: "yes" })).toMatchObject({ success: false, error: expect.stringContaining("boolean") });
  });

  it("needs edit authority only for the temporary item", () => {
    expect(capabilitiesForToolInvocation("inspect_after_effects_render_templates", {})).toEqual(["inspect"]);
    expect(capabilitiesForToolInvocation("inspect_after_effects_render_templates", { allow_temporary_queue_item: true })).toEqual(["inspect", "edit"]);
    expect(toolMayChangeState("inspect_after_effects_render_templates")).toBe(true);
  });
});
