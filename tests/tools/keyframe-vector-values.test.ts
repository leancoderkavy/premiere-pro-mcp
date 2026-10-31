import {beforeEach,describe,expect,it,vi} from "vitest";
import {createContext,runInContext} from "node:vm";
import {parse} from "acorn";
import {getHelpersSource} from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js",()=>({sendCommand:vi.fn()}));
import {sendCommand} from "../../src/bridge/file-bridge.js";
import {getClipboardTools} from "../../src/tools/clipboard.js";
import {getKeyframeTools} from "../../src/tools/keyframes.js";
const tools=getKeyframeTools({}),TPS=254016000000;
const target={node_id:"clip 'quoted' \\",effect_name:"Motion",property_name:"Position"};
function host({current=[.5,.5] as unknown,mode="normal",colour=false,property="Position",effect="Motion"}={}){
 const keys=new Map<string,unknown>();let writes=0,varying=false;const propertyState:any={displayName:property,getValue:()=>current,areKeyframesSupported:()=>true,isTimeVarying:()=>varying,setTimeVarying:(v:boolean)=>{varying=v;},addKey:(t:any)=>{writes++;if(mode!=="ignore")keys.set(t.ticks,current);},setValueAtKey:(t:any,v:any)=>{writes++;if(mode!=="ignore")keys.set(t.ticks,mode==="floor"?v.map((n:number)=>Math.floor(n)):mode==="shape"?[v[0]]:mode==="array-like"?{0:v[0],1:v[1],length:2}:v);},getValueAtKey:(t:any)=>{if(mode==="unreadable")throw Error("unreadable");return keys.get(t.ticks)??null;},getValueAtTime:(t:any)=>keys.get(t.ticks)??current,getKeys:()=>[...keys.keys()].map(ticks=>({ticks})),setInterpolationTypeAtKey:()=>true};
 if(colour)propertyState.getColorValue=()=>[1,.1,.2,.3];
 const component={displayName:effect,matchName:"AE.ADBE Motion",properties:{numItems:1,0:propertyState}},clip={nodeId:target.node_id,name:"Fixture",start:{ticks:"0"},end:{ticks:String(10*TPS)},inPoint:{ticks:String(2*TPS)},getSpeed:()=>1,isSpeedReversed:()=>false,components:{numItems:1,0:component}},seq={videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}},audioTracks:{numTracks:0}};
 const context=createContext({app:{project:{activeSequence:seq}},Time:function(this:any){this.ticks="0";}});
 vi.mocked(sendCommand).mockImplementation(async script=>{parse(script,{ecmaVersion:3,allowReserved:"never"});return JSON.parse(String(runInContext(getHelpersSource()+"\n"+script,context)));});
 return {keys,get writes(){return writes;},get varying(){return varying;}};
}
beforeEach(()=>{vi.mocked(sendCommand).mockReset();});
describe("numeric vector keyframes",()=>{
 it("stores a normalized pair at exact media time and reads every component",async()=>{const h=host();const r=await tools.add_keyframe.handler({...target,time_seconds:1,value:[.5,.3325]});expect(r).toMatchObject({success:true,data:{verified:true,readBackValue:[.5,.3325],coordinateSpace:"normalized",mediaSeconds:3}});expect([...h.keys.entries()]).toEqual([[String(3*TPS),[.5,.3325]]]);});
 for(const mode of ["ignore","floor","shape","unreadable","array-like"])it("does not verify "+mode+" writes",async()=>{const h=host({mode});const r=await tools.add_keyframe.handler({...target,time_seconds:1,value:[.5,.3325]});expect(r).toMatchObject({success:false,data:{verified:false,outcome:"committed_unverified",timelineChanged:true}});expect(h.writes).toBe(2);if(mode==="floor")expect([...h.keys.values()]).toEqual([[0,0]]);});
 for(const [current,value]of [[1,[.5,.5]],[[.5,.5],3],[[.5], [.2,.3]],[[NaN,.5],[.2,.3]],[[.5,.5],[1,2,3,4]]] as [unknown,any][])it("refuses a mismatched current value shape before mutation "+JSON.stringify(value),async()=>{const h=host({current});expect(await tools.add_keyframe.handler({...target,time_seconds:1,value})).toMatchObject({success:false});expect(h.writes).toBe(0);expect(h.varying).toBe(false);});
 it("uses explicit normalized target units even when the current clip is off-frame",async()=>{const h=host({current:[3,-3]});expect(await tools.add_keyframe.handler({...target,time_seconds:1,value:[.5,.3325]})).toMatchObject({success:true,data:{coordinateSpace:"normalized",readBackValue:[.5,.3325]}});expect(h.writes).toBe(2);});
 it("refuses pixel-looking Motion pairs rather than guessing units",async()=>{const h=host();expect(await tools.add_keyframe.handler({...target,time_seconds:1,value:[960,540]})).toMatchObject({success:false,error:expect.stringContaining("normalized")});expect(h.writes).toBe(0);});
 it("refuses animated colour arrays before any keyframe write",async()=>{const h=host({colour:true,current:123456});expect(await tools.add_keyframe.handler({...target,time_seconds:1,value:[1,.1,.2,.3]})).toMatchObject({success:false,error:expect.stringContaining("no lossless time-specific colour setter")});expect(h.writes).toBe(0);});
 for(const value of [[1],[1,2,3],[1,NaN], [Infinity,1], ["x",1],null])it("validates numeric arrays before dispatch "+JSON.stringify(value),async()=>{expect(await tools.add_keyframe.handler({...target,time_seconds:1,value} as any)).toMatchObject({success:false});expect(sendCommand).not.toHaveBeenCalled();});
 it("keeps finite scalar keys working",async()=>{const h=host({current:20});expect(await tools.add_keyframe.handler({...target,time_seconds:1,value:40})).toMatchObject({success:true,data:{readBackValue:40}});expect([...h.keys.values()]).toEqual([40]);});
 it("samples vector values and keeps interpolation explicitly unverified",async()=>{host();await tools.add_keyframe.handler({...target,time_seconds:1,value:[.2,.8]});expect(await tools.get_value_at_time.handler({...target,time_seconds:1})).toMatchObject({success:true,data:{value:[.2,.8]}});expect(await tools.set_keyframe_interpolation.handler({...target,time_seconds:1,interpolation:"linear"})).toMatchObject({success:true,data:{verified:false,outcome:"committed_unverified"}});});
 it("escapes effect and property names in strict ES3",async()=>{const effect="Motion '\" \\",property="Position '\" \\";host({effect,property});expect(await tools.add_keyframe.handler({...target,effect_name:effect,property_name:property,time_seconds:1,value:[.2,.8]})).toMatchObject({success:true});});
});

describe("static vector effect-value copies",()=>{
 for(const mode of ["normal","ignore","shape","string-readback","scalar-to-vector"])it("copies typed vectors with "+mode+" target readback",async()=>{
  const context=createContext({}),array=(v:any)=>runInContext(JSON.stringify(v),context);let value:any=array(mode==="shape"?[.5]:[.5,.5]),writes=0;
  const source={displayName:"Position",getValue:()=>mode==="scalar-to-vector"?.2:array([.2,.8])},target={displayName:"Position",getValue:()=>value,setValue:(v:any)=>{writes++;if(mode!=="ignore")value=mode==="string-readback"?"0.2,0.8":v;}};
  const clip=(id:string,p:any)=>({nodeId:id,components:{numItems:1,0:{displayName:"Motion",properties:{numItems:1,0:p}}}});
  Object.assign(context,{app:{project:{activeSequence:{videoTracks:{numTracks:1,0:{clips:{numItems:2,0:clip("src",source),1:clip("tgt",target)}}},audioTracks:{numTracks:0}}}}});
  vi.mocked(sendCommand).mockImplementation(async script=>{parse(script,{ecmaVersion:3,allowReserved:"never"});return JSON.parse(String(runInContext(getHelpersSource()+"\n"+script,context)));});
  const receipt=await getClipboardTools({}).copy_effect_values.handler({source_node_id:"src",target_node_id:"tgt",effect_name:"Motion"});expect(receipt).toMatchObject({success:mode==="normal"});expect(writes).toBe(mode==="shape"||mode==="scalar-to-vector"?0:1);if(mode==="normal")expect([...value]).toEqual([.2,.8]);
 });
});
