import {beforeEach,describe,expect,it,vi} from "vitest";
import {createContext,runInContext} from "node:vm";
import {parse} from "acorn";
import {getHelpersSource} from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js",()=>({sendCommand:vi.fn()}));
import {sendCommand} from "../../src/bridge/file-bridge.js";
import {getTrackTargetingTools} from "../../src/tools/track-targeting.js";
import {getTimelineTools} from "../../src/tools/timeline.js";
import {getCompetitorGapTools} from "../../src/tools/competitor-gaps.js";
const tools:any={...getTrackTargetingTools({}),...getTimelineTools({}),...getCompetitorGapTools({})};
const id="clip '\" \\",modes=["set_clip_position","set_clip_anchor_point","set_clip_properties","set_clip_properties_batch"];
function args(name:string,x:number,y:number,units?:unknown){return name==="set_clip_properties_batch"?{items:[{node_id:id,position_x:x,position_y:y,...(units===undefined?{}:{units})}]}:name==="set_clip_properties"?{node_id:id,position_x:x,position_y:y,...(units===undefined?{}:{units})}:{node_id:id,x,y,...(units===undefined?{}:{units})};}
function host(mode="normal"){
 const values:any={Position:[.5,.5],"Anchor Point":[.5,.5]};let writes=0;
 const props=Object.keys(values).map(displayName=>({displayName,getValue:()=>values[displayName],setValue:(v:any)=>{writes++;if(mode!=="ignore")values[displayName]=mode==="floor"?v.map((n:number)=>Math.floor(n)):v;return true;}}));
 const clip={nodeId:id,name:"Fixture",projectItem:{getProjectMetadata:()=>'<VideoInfo>1280 x 720</VideoInfo>'},components:{numItems:1,0:{displayName:"Motion",matchName:"AE.ADBE Motion",properties:{numItems:props.length,...props}}}},seq={frameSizeHorizontal:1920,frameSizeVertical:1080,videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}},audioTracks:{numTracks:0}};
 const context=createContext({app:{project:{activeSequence:seq}}});
 vi.mocked(sendCommand).mockImplementation(async script=>{parse(getHelpersSource()+"\n"+script,{ecmaVersion:3,allowReserved:"never"});return JSON.parse(String(runInContext(getHelpersSource()+"\n"+script,context)));});
 return {values,get writes(){return writes;}};
}
beforeEach(()=>{vi.mocked(sendCommand).mockReset();});
describe("explicit Motion coordinate units",()=>{
 for(const name of modes){
  it(name+" stores explicit normalized coordinates",async()=>{const h=host(),r=await tools[name].handler(args(name,.5,.3325,"normalized"));expect(r,JSON.stringify(r)).toMatchObject({success:true,data:{verified:true}});expect(h.values[name==="set_clip_anchor_point"?"Anchor Point":"Position"]).toEqual([.5,.3325]);const item=name==="set_clip_properties_batch"?r.data.items[0]:r.data;expect(item.units).toBe("normalized");expect(item.warning).toBeNull();});
  it(name+" retains implicit pixel semantics and warns for fraction-looking values",async()=>{const h=host(),r=await tools[name].handler(args(name,.5,.3325));expect(r,JSON.stringify(r)).toMatchObject({success:true});const size=name==="set_clip_anchor_point"?[1280,720]:[1920,1080],stored=h.values[name==="set_clip_anchor_point"?"Anchor Point":"Position"];expect(stored[0]).toBeCloseTo(.5/size[0],12);expect(stored[1]).toBeCloseTo(.3325/size[1],12);const item=name==="set_clip_properties_batch"?r.data.items[0]:r.data;expect(item.warning).toContain("look normalized");expect(item.units).toBe("pixels");});
  it(name+" preserves explicit pixel values without an ambiguity warning",async()=>{const h=host(),r=await tools[name].handler(args(name,320,180,"pixels"));expect(r).toMatchObject({success:true});const size=name==="set_clip_anchor_point"?[1280,720]:[1920,1080],stored=h.values[name==="set_clip_anchor_point"?"Anchor Point":"Position"];expect(stored[0]).toBeCloseTo(320/size[0],12);expect(stored[1]).toBeCloseTo(180/size[1],12);const item=name==="set_clip_properties_batch"?r.data.items[0]:r.data;expect(item.warning).toBeNull();});
  for(const mode of ["ignore","floor"])it(name+" refuses "+mode+" coordinate writes",async()=>{const h=host(mode),r=await tools[name].handler(args(name,.2,.8,"normalized"));expect(r).toMatchObject({success:false});expect(h.writes).toBeGreaterThan(0);if(mode==="ignore")expect(h.values[name==="set_clip_anchor_point"?"Anchor Point":"Position"]).toEqual([.5,.5]);});
  for(const values of [[.5,.3,"guess"],[2,.3,"normalized"],[NaN,.3,"pixels"]])it(name+" rejects invalid units or values before dispatch "+JSON.stringify(values),async()=>{expect(await tools[name].handler(args(name,values[0] as number,values[1] as number,values[2]))).toMatchObject({success:false});expect(sendCommand).not.toHaveBeenCalled();});
 }
 it("partial normalized writes leave the other position component unchanged",async()=>{const h=host();expect(await tools.set_clip_properties.handler({node_id:id,position_x:.25,units:"normalized"})).toMatchObject({success:true});expect(h.values.Position).toEqual([.25,.5]);});
 it("refuses units without a coordinate",async()=>{expect(await tools.set_clip_properties.handler({node_id:id,opacity:50,units:"normalized"})).toMatchObject({success:false});expect(sendCommand).not.toHaveBeenCalled();});
});
