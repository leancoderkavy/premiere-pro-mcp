import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js",()=>({sendCommand:vi.fn()}));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { createHost2652, observeHostOverwrite, HostTime, FRAME_NTSC_2997 } from "../helpers/premiere-26-5-2.js";
const T=254016000000,opts={tempDir:"/tmp/boundary-floor",timeoutMs:1000};
function item(hz:number,ignored=false){let left=0,right=15*T;const grid=T/hz;const floor=(s:number)=>{const f=s*T/grid,n=Math.round(f);return (f>0&&Math.abs(f-n)<1e-8?n-1:Math.floor(f))*grid;};return {nodeId:'audio"id',name:"Audio",type:1,getFootageInterpretation:()=>({frameRate:2.75404699046078e-8}),getProjectMetadata:()=>`<p:Column.Intrinsic.MediaType> Audio </p:Column.Intrinsic.MediaType><p:Column.Intrinsic.MediaTimebase> \n ${hz} Hz \t </p:Column.Intrinsic.MediaTimebase>`,getInPoint:()=>({ticks:String(Math.round(left)),seconds:left/T}),getOutPoint:()=>({ticks:String(Math.round(right)),seconds:right/T}),setInPoint:(s:number)=>{if(!ignored)left=floor(s);},setOutPoint:(s:number)=>{if(!ignored)right=floor(s);}};}
function install(source:ReturnType<typeof item>){vi.mocked(sendCommand).mockImplementation(async script=>JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`,{app:{project:{rootItem:{children:Object.assign({numItems:1},[source])}},sourceMonitor:{getProjectItem:()=>source}},Time:class {private v=0;get seconds(){return this.v;}set seconds(s:number){this.v=s;}get ticks(){return String(Math.round(this.v*T));}}}))));}
beforeEach(()=>{vi.clearAllMocks();});
describe("sample-rate-aware boundary writes",()=>{
  it.each([192000,384000,768000])("set_item_in_out is exact at %s Hz",async hz=>{const source=item(hz);install(source);expect(await getTrackTargetingTools(opts).set_item_in_out.handler({item_id:source.nodeId,in_seconds:1.001,out_seconds:4.004})).toMatchObject({success:true,data:{verified:true,mediaType:2}});expect(source.getInPoint().ticks).toBe("254270016000");expect(source.getOutPoint().ticks).toBe("1017080064000");});
  it("Source Monitor does not advance an exact high-rate sample boundary",async()=>{const source=item(384000);install(source);expect(await getSourceMonitorTools(opts).set_source_in_out.handler({in_seconds:1.001,out_seconds:4.004})).toMatchObject({success:true});expect(source.getInPoint().ticks).toBe("254270016000");});
  it("restore and overwrite grids use the item's audio rate",()=>{const source=item(192000);const result=runInNewContext(`${getHelpersSource()}\n[__restoreGridFromItem(item,2),__mediaGridTicks(item,2)]`,{item:source});expect(Array.from(result)).toEqual([T/192000,T/192000]);});
  it.each([false,true])("duplicate audio retains a sample immediately before a sequence-frame boundary (ignored=%s)",async ignored=>{
    const h=createHost2652(),rate=384000,i=h.addItem({hasVideo:false,hasAudio:true,sampleRate:rate,durationSeconds:15});
    h.sequence.setSettings({...h.sequence.getSettings(),videoFrameRate:new HostTime(FRAME_NTSC_2997)});
    const inside=(254270016000-T/rate)/T;
    const original=h.addClip(i,{mediaType:"Audio",inSeconds:inside,outSeconds:inside+3.003,durationSeconds:3.003,linked:false});
    h.addClip(i,{mediaType:"Audio",trackIndex:1,durationSeconds:1,linked:false}).remove();
    i.setOutPoint(inside+3.003+.25/rate,2);i.setInPoint(inside+.25/rate,2);
    const placements=observeHostOverwrite(h,()=>{if(ignored)for(const clip of h.audio.filter(c=>c.nodeId!==original.nodeId)){
      // The ignored-write host deliberately leaves the source In on a wrong frame.
      clip.inPoint=new HostTime(Math.floor(inside*T/FRAME_NTSC_2997)*FRAME_NTSC_2997);
      for(const key of ["inPoint","outPoint"]){const property=Object.getOwnPropertyDescriptor(clip,key)!;Object.defineProperty(clip,key,{get:property.get,set:()=>{}});}
    }});
    vi.mocked(sendCommand).mockImplementation(async script=>JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`,{app:h.app,Time:HostTime}))));
    expect(await getTimelineTools(opts).duplicate_clip.handler({node_id:original.nodeId})).toMatchObject({success:!ignored,data:{verified:!ignored}});
    expect(placements()).toBe(1);
    if(!ignored)expect(h.audio.find(c=>c.nodeId!==original.nodeId).inPoint.ticks).toBe(String(254270016000-T/rate));
  });
  it("ignored high-rate writes fail and invalid input makes no host call",async()=>{const source=item(192000,true);install(source);const tool=getTrackTargetingTools(opts).set_item_in_out;expect(await tool.handler({item_id:source.nodeId,in_seconds:1.001})).toMatchObject({success:false});vi.mocked(sendCommand).mockClear();expect(await tool.handler({item_id:source.nodeId,in_seconds:NaN})).toMatchObject({success:false});expect(sendCommand).not.toHaveBeenCalled();});
});
