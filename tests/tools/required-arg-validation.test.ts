import {beforeEach,describe,expect,it,vi} from "vitest";

// Full catalog setup can contend with other processes on a loaded machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import {parse} from "acorn";
import {runInNewContext} from "node:vm";
vi.mock("../../src/bridge/file-bridge.js",async original=>({...await original<typeof import("../../src/bridge/file-bridge.js")>(),sendCommand:vi.fn(),sendRawCommand:vi.fn()}));
import {sendCommand,sendRawCommand} from "../../src/bridge/file-bridge.js";
import {getHelpersSource} from "../../src/bridge/script-builder.js";
import {getKeyframeTools} from "../../src/tools/keyframes.js";
import {collectTools} from "../../src/server.js";
import {resolveCapabilities} from "../../src/security/capabilities.js";
import {requiredArgumentError} from "../../src/security/required-arguments.js";

const bridge={request:vi.fn(),getState:()=>({connected:true,status:"connected"})};
const tools=collectTools({tempDir:"/tmp/required-arguments-never-dispatched"},resolveCapabilities("inspect,edit,export,filesystem"),bridge as never);
const examples=(schema:any):unknown=>schema?.enum?.[0]??(schema?.type==="string"?"fixture":schema?.type==="boolean"?false:schema?.type==="number"||schema?.type==="integer"?1:schema?.type==="array"?[]:{});
const cases=Object.entries(tools).flatMap(([name,tool])=>(Array.isArray(tool.parameters.required)?tool.parameters.required:[]).map((key:any)=>({name,key,tool,args:Object.fromEntries(Object.entries((tool.parameters.properties??{}) as object).map(([field,schema])=>[field,examples(schema)]))})));
beforeEach(()=>{vi.clearAllMocks();});
describe("required arguments across the complete collected catalog",()=>{
 it("accounts for the complete catalog and every declared top-level required key",()=>{expect(Object.keys(tools).length).toBeGreaterThanOrEqual(532);expect(cases.length).toBeGreaterThan(700);expect(cases.some(c=>c.name==="get_effect_properties"&&c.key==="effect_name")).toBe(true);});
 it.each(cases)("$name refuses missing $key before dispatch",async({name,key,tool,args})=>{
  const omitted={...args};delete omitted[key];
  if(["execute_extendscript","send_raw_script","evaluate_expression"].includes(name))await expect(tool.handler(omitted)).rejects.toMatchObject({code:"CAPABILITY_DENIED"});
  else await expect(tool.handler(omitted)).resolves.toMatchObject({success:false,error:`${key} is required`,data:{code:"INVALID_ARGUMENT",argument:key,mutationOutcome:"not_applied",timelineChanged:false}});
  expect(sendCommand).not.toHaveBeenCalled();expect(sendRawCommand).not.toHaveBeenCalled();expect(bridge.request).not.toHaveBeenCalled();
 });
 it("preserves original handler source for reflection without exposing unguarded execution",async()=>{
  expect(tools.get_effect_properties.handler.toString()).toBe(getKeyframeTools({}).get_effect_properties.handler.toString());
  expect(Object.getOwnPropertyDescriptor(tools.get_effect_properties.handler,"toString")?.enumerable).toBe(false);
  await expect(tools.get_effect_properties.handler({node_id:"clip"})).resolves.toMatchObject({error:"effect_name is required"});
  expect(sendCommand).not.toHaveBeenCalled();
 });
 it("keeps authority ahead of required-argument information and isolates cached definitions",async()=>{
  const denied=collectTools({},resolveCapabilities("edit"));
  await expect(denied.get_effect_properties.handler({})).rejects.toMatchObject({code:"CAPABILITY_DENIED",capability:"inspect"});
  await expect(tools.get_effect_properties.handler({node_id:"clip"})).resolves.toMatchObject({error:"effect_name is required"});
 });
});
describe("direct effect-property factory",()=>{
 const tool=getKeyframeTools({tempDir:"/tmp/required-direct-never-dispatched"}).get_effect_properties;
 it.each([undefined,{}, {node_id:"clip"}, {node_id:"clip",effect_name:undefined}])("refuses incomplete input %j without an escaping exception",async args=>{
  await expect(tool.handler(args as never)).resolves.toMatchObject({success:false,data:{code:"INVALID_ARGUMENT",mutationOutcome:"not_applied"}});expect(sendCommand).not.toHaveBeenCalled();
 });
 it.each([null,1,false,{},[]])("refuses non-string effect_name %j before building code",async effect_name=>{await expect(tool.handler({node_id:"clip",effect_name} as never)).resolves.toMatchObject({error:"effect_name must be a string"});expect(sendCommand).not.toHaveBeenCalled();});
 it("preserves valid lookup, hostile-string escaping and strict ES3",async()=>{
  const name='Motion ẹ̀ṣọ́ " \\ ; return __error("injected")';const clip={name:"clip",components:{numItems:1,0:{displayName:name,matchName:"match",properties:{numItems:0}}}};
  vi.mocked(sendCommand).mockImplementation(async script=>{parse(script,{ecmaVersion:3,allowReserved:"never"});return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`,{app:{project:{activeSequence:{videoTracks:{numTracks:1,0:{clips:{numItems:1,0:{...clip,nodeId:"clip"}}}},audioTracks:{numTracks:0}}}},$:{global:{}}})));});
  await expect(tool.handler({node_id:"clip",effect_name:name})).resolves.toMatchObject({success:true});expect(sendCommand).toHaveBeenCalledTimes(1);
 });
});
describe("required preflight edge cases",()=>{
 const schema={required:["name","count"],properties:{name:{type:"string"},count:{type:"integer"}}};
 it("does not accept inherited required values or an absent own value",()=>{expect(requiredArgumentError(schema,Object.create({name:"inherited",count:0}))).toMatchObject({error:"name is required"});expect(requiredArgumentError(schema,{name:"x",count:undefined})).toMatchObject({error:"count is required"});});
 it("preserves present falsy values and optional/null unions for the schema validator",()=>{expect(requiredArgumentError(schema,{name:"",count:0})).toBeUndefined();expect(requiredArgumentError({required:["nullable"],properties:{nullable:{type:["string","null"]}}},{nullable:null})).toBeUndefined();expect(requiredArgumentError({},undefined)).toBeUndefined();});
});
