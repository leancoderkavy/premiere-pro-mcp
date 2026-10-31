import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { posix, win32 } from "node:path";
import { getHelpersSource, buildToolScript, escapeForExtendScript } from "../../src/bridge/script-builder.js";
import { getAfterEffectsHelpersSource } from "../../src/bridge/after-effects-script-builder.js";
import { buildMogrtPlan, buildMogrtRecipeScript } from "../../src/tools/mogrt-authoring.js";

function host(windows = false) {
  function File(this: { fsName: string }, value: string) {
    this.fsName = windows ? win32.normalize(value) : posix.resolve("/work", value).normalize("NFD");
  }
  return { File, $: { os: windows ? "Windows 11" : "Macintosh" } };
}
const paths = [
  "/work/REEM studio/file.prproj", "/work/quote 'and\" file.prproj", "/work/literal\\file.prproj",
  "/work/child/../file.prproj", "/work/ẹ̀ṣọ́ Café.prproj", "/work/ẹ̀ṣọ́ Café.prproj".normalize("NFD"),
  "/work/clip 🎬.prproj", "/work/" + "long/".repeat(60) + "file.prproj", "/work/folder/", "relative/file.prproj",
];

describe("host path identity", () => {
  it.each(paths)("canonicalizes without case or POSIX backslash loss: %s", value => {
    const source = getHelpersSource() + `\n__normProjectPath("${escapeForExtendScript(value)}");`;
    parse(source, { ecmaVersion: 3, allowReserved: "never" });
    expect(runInNewContext(source, host())).toBe(posix.resolve("/work", value).normalize("NFD"));
  });
  it("does not identify distinct POSIX case/backslash spellings as the same project", () => {
    const source = getHelpersSource();
    expect(runInNewContext(source + '\n__normProjectPath("/work/Shot.prproj") === __normProjectPath("/work/shot.prproj");', host())).toBe(false);
    expect(runInNewContext(source + '\n__normProjectPath("/work/a" + String.fromCharCode(92) + "b.prproj") === __normProjectPath("/work/a/b.prproj");', host())).toBe(false);
  });
  it("keeps Windows drive/UNC case and separator aliases equivalent", () => {
    const source = getHelpersSource();
    const pairs = [["C:\\Work\\Shot.prproj", "c:/work/shot.prproj"], ["\\\\Server\\Share\\Shot.prproj", "\\\\server\\share\\shot.prproj"]];
    for (const [a,b] of pairs) expect(runInNewContext(source + `\n__normProjectPath("${escapeForExtendScript(a)}") === __normProjectPath("${escapeForExtendScript(b)}");`, host(true))).toBe(true);
  });
  it("preserves an empty unsaved-project identity", () => {
    expect(runInNewContext(getHelpersSource() + '\n__normProjectPath("");', host())).toBe("");
  });
  it.each([getHelpersSource, getAfterEffectsHelpersSource])("uses the same containment policy in both helper bundles", helpers => {
    const source = helpers();parse(source, { ecmaVersion: 3, allowReserved: "never" });
    for (const [root, candidate, inside] of [["/Work", "/work/shot.aep", false], ["/work", "/work-other/shot.aep", false], ["/work", "/work/../outside/shot.aep", false], ["/work", "/work/shot.aep", true], ["/", "/work/shot.aep", true], ["", "/work/shot.aep", false]] as const) {
      expect(runInNewContext(source + `\n__hostPathIsInside("${escapeForExtendScript(root)}", "${escapeForExtendScript(candidate)}");`, host())).toBe(inside);
    }
  });
  it("recipe creation refuses a case-distinct project outside its approved directory", () => {
    const plan = buildMogrtPlan({ approved_workspace_path: "/Approved", output_directory: "/Approved", template_name: "Title", headline: "Ẹ̀ṣọ́" }, () => true);
    const script = getAfterEffectsHelpersSource() + buildMogrtRecipeScript(plan);
    parse(script, { ecmaVersion: 3, allowReserved: "never" });
    const result = JSON.parse(String(runInNewContext(script, { ...host(), app: { project: { file: { fsName: "/approved/source.aep" } } } })));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("outside approved_workspace_path") });
  });
  it("project guards embed hostile path strings as literals", () => {
    const value = '/work/quote"\\path\nline.prproj';
    const body = `return __result(__normProjectPath("${escapeForExtendScript(value)}"));`;
    const script = buildToolScript(body);parse(script, { ecmaVersion: 3, allowReserved: "never" });
    const result = JSON.parse(String(runInNewContext(getHelpersSource() + script, host())));
    expect(result.data).toBe(value.normalize("NFD"));
  });
});
