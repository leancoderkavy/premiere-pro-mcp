import {createRequire} from "node:module";
import {describe,expect,it,vi} from "vitest";
const require=createRequire(import.meta.url);
const Workspace=require("../../uxp-plugin/workspace.cjs");
function fixture(nativePath:string,resolver?: (value:string)=>Promise<string>){
 const root={isFolder:true,name:"Approved",nativePath,getEntry:vi.fn(async()=>({isFolder:false,nativePath:nativePath+"/clip.mov"}))};
 const fs={getFolder:vi.fn(async()=>root),createPersistentToken:vi.fn(async()=>"fixture-token"),getDataFolder:vi.fn(async()=>({createFile:vi.fn(async()=>({write:vi.fn()}))}))};
 return {root,broker:Workspace.createWorkspaceBroker({fs,resolveCanonicalPath:resolver})};
}
describe("workspace path forms",()=>{
 it.each([["/","/clip.mov"],["C:/","C:/clip.mov"],["\\\\Server\\Share","//server/share/clip.mov"]])("keeps a selected filesystem root stable: %s",async(root,child)=>{
  expect(Workspace.isContained(root,child,false)).toBe(true);
  const normalized=Workspace.parseAbsolutePath(root,"root").normalized;
  expect(Workspace.parseAbsolutePath(normalized,"root").kind).toBe(Workspace.parseAbsolutePath(root,"root").kind);
  const f=fixture(root,async value=>value);await expect(f.broker.requestRoot()).rejects.toMatchObject({code:"UXP_WORKSPACE_TOO_BROAD"});
 });
 it("round-trips an approved UNC subfolder without losing its namespace",async()=>{
  const f=fixture("\\\\Server\\Share\\Project",async value=>value);await f.broker.requestRoot();
  expect(await f.broker.assertPathAllowed("//server/share/Project/clip.mov",{kind:"file"})).toBe("//server/share/Project/clip.mov");
 });
 it("accepts an NFC alias only after an independent resolver proves the canonical folder",async()=>{
  const root="/Volumes/ẹ̀ṣọ́ Café".normalize("NFD"),candidate=(root+"/clip 🎬.mov").normalize("NFC");
  const resolver=vi.fn(async(value:string)=>value.normalize("NFD"));const f=fixture(root,resolver);await f.broker.requestRoot();
  expect(await f.broker.assertPathAllowed(candidate,{kind:"file"})).toBe(candidate.normalize("NFD"));expect(resolver).toHaveBeenCalledTimes(2);
 });
 it("uses a safe native URL resolver for Unicode aliases when that primitive is available",async()=>{
  const root="/Volumes/ẹ̀ṣọ́ Café".normalize("NFD"),candidate=(root+"/quote #?% \\\"clip.mov").normalize("NFC");
  const entry={isFolder:true,name:"Approved",nativePath:root};
  const getEntryWithUrl=vi.fn(async(url:string)=>{const path=decodeURIComponent(url.slice(5)).normalize("NFD");return {nativePath:path,isFolder:path===root,isFile:path!==root};});
  const fs={getFolder:async()=>entry,getEntryWithUrl,createPersistentToken:async()=>"token",getDataFolder:async()=>({createFile:async()=>({write:async()=>{}})})};
  const broker=Workspace.createWorkspaceBroker({fs});await broker.requestRoot();
  expect(await broker.assertPathAllowed(candidate,{kind:"file"})).toBe(candidate.normalize("NFD"));
  const url=getEntryWithUrl.mock.calls.at(-1)![0];expect(url).toContain("%23%3F%25");expect(url).toContain("%5C%22");expect(url).not.toContain("#");expect(url).not.toContain("?");
 });
 it("encodes filename URL delimiters without losing the requested filesystem name",async()=>{
  const path="/Volumes/Approved/quote #?% \\\"clip.mov";
  const getEntryWithUrl=vi.fn(async(url:string)=>({nativePath:decodeURIComponent(new URL(url).pathname),isFile:true}));
  const resolve=Workspace.createCanonicalPathResolver({fs:{getEntryWithUrl}});
  expect(await resolve(path,{kind:"file"})).toBe(path);
 });
 it("does not authorize a distinct canonical sibling just because Unicode normalizes equally",async()=>{
  const root="/Volumes/ẹ̀ṣọ́ Café".normalize("NFD"),candidate=(root+"/clip.mov").normalize("NFC");
  const f=fixture(root,async value=>value);await f.broker.requestRoot();await expect(f.broker.assertPathAllowed(candidate,{kind:"file"})).rejects.toMatchObject({code:"UXP_PATH_OUTSIDE_WORKSPACE"});
 });
 it("refuses a Unicode-root alias without independent identity proof even when Entry walking is available",async()=>{
  const root="/Volumes/ẹ̀ṣọ́ Café".normalize("NFD"),candidate=(root+"/clip.mov").normalize("NFC");
  const f=fixture(root);await f.broker.requestRoot();await expect(f.broker.assertPathAllowed(candidate,{kind:"file"})).rejects.toMatchObject({code:"UXP_CANONICAL_PATH_UNAVAILABLE",message:expect.stringContaining("Unicode spelling")});expect(f.root.getEntry).not.toHaveBeenCalled();
 });
 it.each(["/Volumes/Approved/../outside/clip.mov","/Volumes/approved/clip.mov","/Volumes/ApprovedSibling/clip.mov"])("refuses an outside spelling before canonical lookup: %s",async candidate=>{
  const resolver=vi.fn(async(value:string)=>value);const f=fixture("/Volumes/Approved",resolver);await f.broker.requestRoot();await expect(f.broker.assertPathAllowed(candidate,{kind:"file"})).rejects.toMatchObject({code:"UXP_PATH_OUTSIDE_WORKSPACE"});expect(resolver).not.toHaveBeenCalled();
 });
 it.each(["space file.mov","quote 'and\".mov","literal\\name.mov","clip 🎬.mov","ẹ̀ṣọ́.mov","x/".repeat(150)+"clip.mov"])("preserves supported POSIX leaf spelling: %s",async leaf=>{
  const candidate="/Volumes/Approved/"+leaf;const f=fixture("/Volumes/Approved",async value=>value);await f.broker.requestRoot();expect(await f.broker.assertPathAllowed(candidate,{kind:"file"})).toBe(candidate);
 });
 it("refuses relative and NUL paths without asking a resolver",async()=>{
  const resolver=vi.fn(async(value:string)=>value);const f=fixture("/Volumes/Approved",resolver);await f.broker.requestRoot();for(const p of ["relative.mov","/Volumes/Approved/nul\0.mov"])await expect(f.broker.assertPathAllowed(p,{kind:"file"})).rejects.toMatchObject({code:"UXP_INVALID_ARGUMENT"});expect(resolver).not.toHaveBeenCalled();
 });
});
