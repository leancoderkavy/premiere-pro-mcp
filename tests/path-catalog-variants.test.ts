import {expect,it,vi} from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import * as acorn from "acorn";
import {Client,InMemoryTransport} from "@modelcontextprotocol/client";
const sink=vi.hoisted(()=>({process:[] as unknown[][],fs:[] as string[]}));
vi.mock("../src/bridge/file-bridge.js",()=>({sendCommand:vi.fn().mockResolvedValue({success:false,error:"Fixture stops native dispatch"}),sendRawCommand:vi.fn().mockResolvedValue({success:false,error:"Fixture stops native dispatch"}),withBridgeWorkflow:(_o:unknown,work:()=>unknown)=>work(),getTempDir:()=>process.env.PREMIERE_TEMP_DIR,cleanupTempDir:vi.fn()}));
vi.mock("../src/bridge/after-effects-bridge.js",async original=>({...await original(),sendAfterEffectsCommand:vi.fn().mockResolvedValue({success:false,error:"Fixture stops native dispatch"})}));
vi.mock("node:child_process",async original=>{
 const actual=await original() as Record<string,unknown>;
 const stop=(...args:unknown[])=>{sink.process.push(args);throw Error("Fixture stops external processes");};
 Object.defineProperty(stop,Symbol.for("nodejs.util.promisify.custom"),{value:async(...args:unknown[])=>stop(...args)});
 return {...actual,execFile:stop,execFileSync:stop,execSync:stop,spawn:stop,spawnSync:stop,default:{...actual,execFile:stop,execFileSync:stop,execSync:stop,spawn:stop,spawnSync:stop}};
});
vi.mock("node:fs",async original=>{
 const actual=await original() as Record<string,any>,wrapped:Record<string,unknown>={};
 for(const key of ["readFileSync","statSync","lstatSync","realpathSync","existsSync","openSync"]){const fn=(...args:unknown[])=>{if(typeof args[0]==="string")sink.fs.push(args[0]);return actual[key](...args);};Object.assign(fn,actual[key]);wrapped[key]=fn;}
 return {...actual,...wrapped,default:{...actual,...wrapped}};
});
vi.mock("node:fs/promises",async original=>{
 const actual=await original() as Record<string,any>,wrapped:Record<string,unknown>={};
 for(const key of ["readFile","stat","lstat","realpath","access","open"]){wrapped[key]=(...args:unknown[])=>{if(typeof args[0]==="string")sink.fs.push(args[0]);return actual[key](...args);};}
 return {...actual,...wrapped,default:{...actual,...wrapped}};
});
import {sendCommand,sendRawCommand} from "../src/bridge/file-bridge.js";
import {sendAfterEffectsCommand} from "../src/bridge/after-effects-bridge.js";
import {createServer} from "../src/server.js";
import {getHelpersSource} from "../src/bridge/script-builder.js";
import {getAfterEffectsHelpersSource} from "../src/bridge/after-effects-script-builder.js";
import type {UxpWebSocketBridge} from "../src/bridge/uxp-websocket-bridge.js";
type Schema=Record<string,any>;
let activeTool="";
const pathKey=/(?:^path$|_paths?$|_files?$|_folders?$|_director(?:y|ies)$|^paths$|^file_paths$|^filename$)/;
const excluded=new Set(["expected_project_path","expected_target","expected_cep_target","object_path","bin_path"]);
function pathFields(schema:Schema,prefix="",depth=0):string[]{
 if(depth>6)return [];
 return Object.entries(schema.properties||{}).flatMap(([key,value])=>{
  if(excluded.has(key))return [];const child=value as Schema,name=prefix?prefix+"."+key:key;
  if(pathKey.test(key)&&(child.type==="string"||child.type==="array"&&child.items?.type==="string"))return [name];
  if(child.properties)return pathFields(child,name,depth+1);
  if(child.items?.properties)return pathFields(child.items,name+"[]",depth+1);
  return [];
 });
}
function sample(schema:Schema={},key="",depth=0):any{
 if(depth>6)return {};
 if(schema.enum)return schema.enum[0];if(schema.const!==undefined)return schema.const;
 const type=Array.isArray(schema.type)?schema.type.find((t:string)=>t!=="null"):schema.type;
 if(type==="object"||schema.properties)return Object.fromEntries((schema.required||[]).map((name:string)=>[name,sample(schema.properties?.[name],name,depth+1)]));
 if(type==="array")return Array.from({length:Math.max(schema.minItems||1,1)},()=>sample(schema.items,key,depth+1));
 if(type==="boolean")return true;
 if(type==="integer"||type==="number")return Math.min(schema.maximum??Infinity,Math.max(schema.minimum??0,/frame_rate/.test(key)?25:/end|out/.test(key)?2:1));
 if(schema.pattern?.includes("sha256"))return "sha256:"+"a".repeat(64);
 if(/_ticks$/.test(key))return "0";
 if(/revision|sha256|hash/.test(key))return "a".repeat(64);
 return "fixture";
}
function fill(schema:Schema,dir:string,files:Record<string,string>,key="",depth=0):any{
 if(depth>6)return sample(schema,key,depth);
 if(pathKey.test(key)){
  const semantic=/edl/.test(activeTool)?"edl":/fcpxml|fcp_xml/.test(activeTool)?"xml":/mogrt/.test(activeTool)?"mogrt":/temporal_render/.test(activeTool)?"json":/project|backup/.test(activeTool)?"prproj":"mov";
  const extension=/preset/.test(key)?"epr":/aep/.test(key)?"aep":/project/.test(key)?"prproj":/caption|srt/.test(key)?"srt":/json|data|correction|manifest/.test(key)?"json":/logo/.test(key)?"png":/lut/.test(key)?"cube":semantic;
  const path=/director|folder|workspace|root/.test(key)?dir:files[/output/.test(key)?"output_"+extension:extension];
  if(schema.type==="string")return key==="filename"?"quote 'frame.png":path;
  if(schema.type==="array"&&schema.items?.type==="string")return [path];
 }
 if(schema.type==="object"||schema.properties){const value=sample(schema,key,depth);for(const [name,child] of Object.entries(schema.properties||{}) as [string,Schema][]){if(excluded.has(name))continue;if(pathFields({properties:{[name]:child}}).length)value[name]=fill(child,dir,files,name,depth+1);}return value;}
 if(schema.type==="array"&&schema.items?.properties)return [fill(schema.items,dir,files,key,depth+1)];
 return sample(schema,key,depth);
}
function inspect(script:string){
 const ast=acorn.parse(script,{ecmaVersion:3,allowReserved:"never",allowReturnOutsideFunction:true});const literals:string[]=[];
 const walk=(node:any)=>{if(!node||typeof node!=="object")return;if(node.type==="Literal"&&typeof node.value==="string")literals.push(node.value);if(node.type==="CallExpression"&&node.callee?.object?.name==="app"&&node.callee?.property?.name==="quit")throw Error("Unexpected application exit expression");for(const [key,value] of Object.entries(node))if(key!=="loc"){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object")walk(value);}};walk(ast);return literals;
}
it("every declared file-path surface preserves transport literals or refuses before dispatch",async()=>{
 const root=mkdtempSync(join(tmpdir(),"path-catalog-"));let client:Client|undefined,server:ReturnType<typeof createServer>|undefined;
 const variants=["spaces","quotes","backslash","traversal","symlink","long","nfc","nfd","yoruba","emoji","trailing","relative"];
 const fixtures=new Map<string,{dir:string;files:Record<string,string>}>();
 for(const label of variants){
  const name={spaces:"REEM studio",quotes:"quote 'and\"",backslash:"literal\\folder",long:"long/".repeat(55),nfc:"Café".normalize("NFC"),nfd:"Café".normalize("NFD"),yoruba:"ẹ̀ṣọ́",emoji:"clip 🎬"}[label]||label;
  let dir=join(root,process.platform==="win32"&&label==="quotes"?"quote apostrophe '":name);mkdirSync(dir,{recursive:true});
  const files:Record<string,string>={};for(const extension of ["mov","epr","prproj","json","srt","edl","xml","mogrt","png","cube","aep"]){const content=extension==="json"?"{}":extension==="srt"?"1\n00:00:00,000 --> 00:00:01,000\nẸ̀ṣọ́\n":extension==="edl"?"TITLE: Fixture\nFCM: NON-DROP FRAME\n001 AX V C 00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n":"<fixture />";files[extension]=join(dir,"fixture."+extension);writeFileSync(files[extension],content);files["output_"+extension]=join(dir,"output."+extension);writeFileSync(files["output_"+extension],content);}
  if(label==="quotes"&&process.platform==="win32"){dir+="\"";for(const ext of Object.keys(files))files[ext]=join(dir,"fixture."+ext);}
  if(label==="traversal"){mkdirSync(join(dir,"child"));dir+="/child/..";for(const ext of Object.keys(files))files[ext]=dir+"/fixture."+ext;}
  if(label==="symlink"&&process.platform!=="win32"){const link=join(root,"alias");symlinkSync(dir,link,"dir");for(const ext of Object.keys(files))files[ext]=join(link,"fixture."+ext);dir=link;}
  if(label==="trailing"){dir+="/";for(const ext of Object.keys(files))files[ext]+="/";}
  if(label==="relative"){dir="relative";for(const ext of Object.keys(files))files[ext]="relative/fixture."+ext;}
  fixtures.set(label,{dir,files});
 }
 const uxp={request:vi.fn().mockRejectedValue(new Error("Fixture stops native request")),getState:()=>({connected:true}),refreshCapabilities:async()=>{}};
 const observations:Record<string,unknown>[]=[];let cases=0,scripts=0;
 vi.stubEnv("PREMIERE_MCP_CAPABILITIES","inspect,edit,export,filesystem");vi.stubEnv("PREMIERE_CONTEXT_BACKEND","memory");vi.stubEnv("PREMIERE_CONTEXT_DIR",join(root,"context"));vi.stubEnv("PREMIERE_TEMP_DIR",root);
 try{
  server=createServer({tempDir:root,timeoutMs:10},{toolPacks:"full",uxpBridge:uxp as unknown as UxpWebSocketBridge,telemetry:{enabled:false,capture:()=>{},shutdown:async()=>{}}});client=new Client({name:"path-check",version:"1"});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(b),client.connect(a)]);
  acorn.parse(getHelpersSource(),{ecmaVersion:3,allowReserved:"never"});acorn.parse(getAfterEffectsHelpersSource(),{ecmaVersion:3,allowReserved:"never"});
  const definitions=(await client.listTools()).tools.filter(t=>pathFields(t.inputSchema).length>0);
  expect(definitions.length).toBeGreaterThan(80);
  for(const tool of definitions){activeTool=tool.name;let reached=0,refused=0;const fields=pathFields(tool.inputSchema);
   for(const label of variants){const f=fixtures.get(label)!;const args=fill(tool.inputSchema,f.dir,f.files);
    const action={manage_project_sessions_uxp:"validate",manage_growing_media_uxp:"pause",maintain_media_health_uxp:"find_by_media_path",manage_proxy_ingest_uxp:"attach_proxy",audition_source_monitor_uxp:"open_file"}[tool.name];if(action)args.action=action;
    if(tool.name==="verify_delivery_conformance")args.width=640;
    vi.mocked(sendCommand).mockClear();vi.mocked(sendRawCommand).mockClear();vi.mocked(sendAfterEffectsCommand).mockClear();uxp.request.mockClear();sink.process.length=0;sink.fs.length=0;
    let result:any;try{result=await client.callTool({name:tool.name,arguments:args});}catch(error){result={isError:true,error:String(error)};}
    const packets=[...vi.mocked(sendCommand).mock.calls,...vi.mocked(sendRawCommand).mock.calls,...vi.mocked(sendAfterEffectsCommand).mock.calls].map(call=>String(call[0]));
    const values=packets.flatMap(inspect);scripts+=packets.length;
    const encoded=JSON.stringify(uxp.request.mock.calls);JSON.parse(encoded);
    const expected=Object.values(f.files).concat(f.dir).flatMap(p=>[p,resolve(p)]);
    const used=values.some(v=>expected.includes(v))||uxp.request.mock.calls.some(call=>expected.some(p=>JSON.stringify(call).includes(JSON.stringify(p).slice(1,-1))))||sink.fs.some(p=>expected.includes(p))||sink.process.some(call=>expected.some(p=>JSON.stringify(call).includes(JSON.stringify(p).slice(1,-1))));
    if(used)reached++;if(result?.isError||result?.structuredContent?.ok===false)refused++;
    expect(JSON.stringify(result)).not.toContain("SyntaxError");cases++;
   }
   observations.push({tool:tool.name,pathFields:fields,attempted:variants.length,pathReached:reached,refused,scope:"argument/schema/transport/local-access checks; native dispatch deliberately stopped"});
  }
  expect(cases).toBe(definitions.length*variants.length);expect(scripts).toBeGreaterThan(0);
  if(process.env.PATH_VARIANT_REPORT)writeFileSync(process.env.PATH_VARIANT_REPORT,JSON.stringify({tools:definitions.length,cases,scripts,variants,rows:observations},null,2)+"\n");
 }finally{await client?.close();await server?.close();vi.unstubAllEnvs();rmSync(root,{recursive:true});}
},120000);
