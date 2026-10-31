import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); vi.clearAllMocks(); });
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"preset-path-"));directories.push(root);
  const folder=join(root,"3F3F3F3F_4D6F6F56");mkdirSync(folder);
  const seen:string[]=[];
  vi.mocked(sendCommand).mockImplementation(async script => {
    parse(script,{ecmaVersion:3,allowReserved:"never"});
    return JSON.parse(String(runInNewContext(getHelpersSource()+script,{app:{project:{activeSequence:{name:"Fixture",getExportFileExtension:(path:string)=>{seen.push(path);return undefined;}}}}})));
  });
  return {root,folder,seen,tool:getSequenceTools({}).get_export_file_extension};
}
const names=["space file.epr","quote 'and\" file.epr","ẹ̀ṣọ́ Café.epr","ẹ̀ṣọ́ Café.epr".normalize("NFD"),"clip 🎬.epr"];
describe("preset path variants",()=>{
 it.each(process.platform==="win32"?names.filter(name=>!name.includes('"')):names)("preserves and reports a real preset spelling: %s",async name=>{
  const f=fixture(),path=join(f.folder,name);writeFileSync(path,"<preset />");
  expect(await f.tool.handler({preset_path:path})).toMatchObject({success:true,data:{extension:".mov",hostConfirmed:false,presetPath:realpathSync(path)}});
  expect(f.seen).toEqual([path]);
 });
 it.skipIf(process.platform==="win32")("treats a POSIX backslash as part of the filename",async()=>{
  const f=fixture(),path=join(f.folder,"preset\\literal.epr");writeFileSync(path,"<preset />");
  expect(await f.tool.handler({preset_path:path})).toMatchObject({success:true,data:{extension:".mov",presetPath:realpathSync(path)}});expect(f.seen).toEqual([path]);
 });
 it("normalizes traversal segments using the existing physical file",async()=>{
  const f=fixture();mkdirSync(join(f.folder,"child"));const actual=join(f.folder,"preset.epr");writeFileSync(actual,"<preset />");
  expect(await f.tool.handler({preset_path:f.folder+"/child/../preset.epr"})).toMatchObject({success:true,data:{extension:".mov",presetPath:realpathSync(actual)}});
 });
 it.skipIf(process.platform==="win32")("handles a total path longer than255 bytes with ordinary-length components",async()=>{
  const f=fixture(),parent=join(f.root,...Array(18).fill("long folder names"),"3F3F3F3F_4D6F6F56");mkdirSync(parent,{recursive:true});const path=join(parent,"preset.epr");writeFileSync(path,"<preset />");expect(Buffer.byteLength(path)).toBeGreaterThan(255);
  expect(await f.tool.handler({preset_path:path})).toMatchObject({success:true,data:{extension:".mov",presetPath:realpathSync(path)}});
 });
 it.skipIf(process.platform==="win32")("does not infer a symlink target's format from the alias folder",async()=>{
  const f=fixture(),target=join(f.root,"unknown.epr"),alias=join(f.folder,"alias.epr");writeFileSync(target,"<preset />");symlinkSync(target,alias);
  expect(await f.tool.handler({preset_path:alias})).toMatchObject({success:false});
 });
 it.skipIf(process.platform==="win32")("reports the physical preset when a contained symlink is inspectable",async()=>{
  const f=fixture(),target=join(f.folder,"target.epr"),alias=join(f.folder,"alias.epr");writeFileSync(target,"<preset />");symlinkSync(target,alias);
  expect(await f.tool.handler({preset_path:alias})).toMatchObject({success:true,data:{extension:".mov",hostConfirmed:false,presetPath:realpathSync(target)}});
 });
 it("refuses a file path with a trailing slash and an overlong component",async()=>{
  const f=fixture(),path=join(f.folder,"preset.epr");writeFileSync(path,"<preset />");
  expect(await f.tool.handler({preset_path:path+"/"})).toMatchObject({success:false});
  expect(await f.tool.handler({preset_path:join(f.folder,"x".repeat(300)+".epr")})).toMatchObject({success:false});
 });
 it.each(["relative/preset.epr","/absolute/has\0nul.epr",""])("refuses an invalid server path before dispatch: %s",async path=>{
  const f=fixture();expect(await f.tool.handler({preset_path:path})).toMatchObject({success:false,error:expect.stringContaining("absolute path")});expect(sendCommand).not.toHaveBeenCalled();expect(f.seen).toEqual([]);
 });
 it.skipIf(process.platform!=="darwin")("opens an NFD-named preset through its NFC filesystem alias",async()=>{
  const f=fixture(),nfd=join(f.folder,"ẹ̀ṣọ́ Café.epr".normalize("NFD"));writeFileSync(nfd,"<preset />");const nfc=nfd.normalize("NFC");
  const result=await f.tool.handler({preset_path:nfc}) as {success:boolean;data:{extension:string;hostConfirmed:boolean;presetPath:string}};
  expect(result).toMatchObject({success:true,data:{extension:".mov",hostConfirmed:false}});
  expect(result.data.presetPath.normalize("NFC")).toBe(realpathSync(nfd).normalize("NFC"));
  expect(statSync(result.data.presetPath).ino).toBe(statSync(nfd).ino);
 });
});
