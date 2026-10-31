import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationTicks: vi.fn().mockResolvedValue(100 * 254016000000) }));
import { getExtendedEditPlanTools } from "../../src/tools/extended-edit-plans.js";
import { snapshotRevision } from "../../src/ai/timeline-contract.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { rippleRemoveRangesScript } from "../../src/tools/ripple-remove-ranges.js";
import { rippleDeleteScriptBody } from "../../src/tools/ripple-delete-script.js";
import { getTransitionsTools } from "../../src/tools/transitions.js";
const T = 254016000000;
const time = (s: number) => ({ ticks: String(Math.round(s * T)) });
function collection(items: any[]) { Object.defineProperty(items, "numItems", { get: () => items.length }); return items; }
function fixture(mode = "write") {
  const transitions = collection([{ nodeId: "dissolve", name: "Cross Dissolve", start: time(23.8), end: time(24.2), remove: vi.fn() }]);
  transitions[0].remove.mockImplementation((...args: unknown[]) => { if (args.length !== 2) throw Error("Not Enough Parameters"); if (mode !== "ignore") transitions.splice(0, 1); });
  const track = { transitions, clips: collection([]) };
  const seq = { sequenceID: "sequence", timebase: String(T / 25), videoTracks: { 0: track, numTracks: 1 }, audioTracks: { numTracks: 0 } };
  const globals = { File: function(this: {fsName:string}, path:string) { this.fsName=path; }, $: {os:"Mac OS"}, app: { enableQE() {}, project: {path:"/project.prproj", documentID:"project", activeSequence: seq } }, qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: () => ({isLocked: () => false, isSyncLocked: () => true}) }) } } };
  const run = (script: string) => { parse(script, { ecmaVersion: 3, allowReserved: "never" }); return JSON.parse(runInNewContext(getHelpersSource() + script, globals)); };
  return { transitions, track, seq, run };
}
beforeEach(() => vi.clearAllMocks());
describe("transition-safe structural edits", () => {
  it("refuses the measured dissolve before trim/move can strand it", () => {
    const h = fixture(); const result = h.run('var failure = __transitionEditGuard(app.project.activeSequence, [{type:"video",index:0,start:0,end:24*254016000000}]); failure || __result({});');
    expect(result).toMatchObject({ success: false, data: { timelineChanged: false, mutationOutcome: "not_applied", transitionsAffected: [{ index: 0, startTicks: String(23.8 * T), endTicks: String(24.2 * T) }] } });
    expect(result.error).toContain("remove_transition"); expect(h.transitions).toHaveLength(1);
  });
  it("the real move handler refuses before any clip write", async () => {
    const h = fixture(); const move = vi.fn();
    h.track.clips.push({nodeId:"clip",name:"Clip",start:time(20),end:time(24),inPoint:time(0),outPoint:time(4),move});
    vi.mocked(sendCommand).mockImplementation(async script => h.run(script));
    expect(await getTimelineTools({}).move_clip.handler({node_id:"clip",new_start_seconds:30})).toMatchObject({success:false,data:{timelineChanged:false,transitionsAffected:[{index:0}]}});
    expect(move).not.toHaveBeenCalled();
  });
  it("guards the snapped destination when a fractional request lies just past a transition", async () => {
    const h=fixture(); h.transitions[0].start=time(29.8); h.transitions[0].end=time(30.01);
    h.track.clips.push({nodeId:"clip",name:"Clip",start:time(20),end:time(24),inPoint:time(0),outPoint:time(4)});
    vi.mocked(sendCommand).mockImplementation(async script=>h.run(script));
    expect(await getTimelineTools({}).move_clip.handler({node_id:"clip",new_start_seconds:30.018})).toMatchObject({success:false,data:{timelineChanged:false,transitionsAffected:[{startTicks:String(29.8*T)}]}});
  });
  it("preserves exact native tick strings beyond safe numeric precision", () => {
    const h=fixture();h.transitions[0].start.ticks="9007199254740993";h.transitions[0].end.ticks="9007199254740999";
    expect(h.run('__result(__transitionSnapshot(app.project.activeSequence.videoTracks[0]));').data[0]).toMatchObject({startTicks:"9007199254740993",endTicks:"9007199254740999"});
  });
  it("compound preview checks the snapped move destination before issuing any token", async () => {
    const h=fixture();h.transitions[0].start=time(29.8);h.transitions[0].end=time(30);
    const clip={nodeId:"clip",projectItem:{nodeId:"source"},start:time(20),end:time(24),inPoint:time(0),outPoint:time(4)};h.track.clips.push(clip);
    const snapshot:any={schema_version:1,backend:"cep",project_id:"project",sequence_id:"sequence",session_id:"session",revision:"",frame_rate:{numerator:25,denominator:1},display_start_ticks:"0",tracks:[{id:"video:0",type:"video",index:0,locked:false,sync_locked:true,targeted:true,muted:false}],clips:[{id:"clip",source_id:"source",track_id:"video:0",start_ticks:clip.start.ticks,end_ticks:clip.end.ticks,in_ticks:clip.inPoint.ticks,out_ticks:clip.outPoint.ticks,source_duration_ticks:String(100*T),speed:{numerator:1,denominator:1},reversed:false,enabled:true,linked_ids:[],identity:"host",effects:[],nested:false}],completeness:{clips:true,links:true,locks:true,effects:true,transitions:true,markers:true},transitions:[],markers:[],pagination:{offset:0,total:1,next_offset:null}};snapshot.revision=snapshotRevision(snapshot);
    const writer=vi.fn();const tool=getExtendedEditPlanTools({}, {send:async script=>h.run(script),getToolCatalog:()=>({move_clip:{handler:writer}}) as any});
    const result=await tool.preview_extended_edit_plan.handler({plan:{project_path:"/project.prproj",snapshot,steps:[{tool:"move_clip",clip_id:"clip",args:{node_id:"clip",new_start_seconds:30.018}}]}});
    expect(result).toMatchObject({success:false,data:{timelineChanged:false,transitionsAffected:[{index:0}]}});expect(writer).not.toHaveBeenCalled();
  });
  it.each(["trim", "duration change"])("linked %s preflights before invoking any writer", label => {
    const h=fixture();
    expect(h.run('var target={trackType:"video",trackIndex:0,clip:{nodeId:"clip",start:{ticks:"'+20*T+'"},end:{ticks:"'+24*T+'"}}}; __runLinkedEdit(target,"clip",false,function(){throw new Error("writer must not run");},"'+label+'");')).toMatchObject({success:false,data:{transitionsAffected:[{index:0}],timelineChanged:false}});
  });
  it("range ripple refuses a later transition before razor or removal", () => {
    const h=fixture();
    expect(h.run(rippleRemoveRangesScript({ranges:[{start:0,end:1}],scope:"sync_locked",range_content:"delete"},true))).toMatchObject({success:false,data:{transitionsAffected:[{index:0}],timelineChanged:false}});
  });
  it("single ripple refuses its participating suffix before removing the target", () => {
    const h=fixture(); const remove=vi.fn();
    h.track.clips.push({nodeId:"clip",name:"Clip",start:time(0),end:time(1),getLinkedItems:()=>null,remove});
    expect(h.run('(function(){'+rippleDeleteScriptBody({nodeId:"clip",scope:"own_track",rangeDelete:false,dryRun:false})+'})()')).toMatchObject({success:false,data:{transitionsAffected:[{index:0}],timelineChanged:false}});
    expect(remove).not.toHaveBeenCalled();
  });
  it("accepts readable empty tracks and leaves unrelated earlier transitions alone", () => {
    const h = fixture(); expect(h.run('__transitionEditGuard(app.project.activeSequence,[{type:"video",index:0,start:30*254016000000,end:40*254016000000}]) || __result({verified:true});')).toMatchObject({success:true});
    h.transitions.splice(0); expect(h.run('__transitionEditGuard(app.project.activeSequence,[{type:"video",index:0,start:0,end:1}]) || __result({verified:true});').success).toBe(true);
  });
  it.each([undefined, { numItems: NaN }, { numItems: -1 }, { numItems: 10001 }])("refuses unreadable transition collection %s", (unreadable) => {
    const h = fixture(); (h.track as any).transitions = unreadable;
    expect(h.run('__transitionEditGuard(app.project.activeSequence,[{type:"video",index:0,start:0,end:1}]) || __result({});')).toMatchObject({ success:false, data:{ timelineChanged:false, transitionsAffected:null } });
  });
  it("refuses unreadable transition geometry even outside the edit span", () => {
    const h = fixture(); h.transitions[0].start.ticks = "unknown";
    expect(h.run('__transitionEditGuard(app.project.activeSequence,[{type:"video",index:0,start:0,end:1}]) || __result({});').success).toBe(false);
  });
});
describe("remove_transition", () => {
  it("uses two false arguments and verifies the exact remaining spans", async () => {
    const h = fixture(); const remove = h.transitions[0].remove;
    vi.mocked(sendCommand).mockImplementation(async script => h.run(script));
    const tool = (getTransitionsTools({}) as any).remove_transition;
    expect(tool).toBeDefined();
    const result = await tool.handler({ track_index:0, transition_index:0 });
    expect(result).toMatchObject({success:true,data:{verified:true,outcome:"verified",transitionsRemoved:1}});
    expect(remove).toHaveBeenCalledWith(false,false); expect(h.transitions).toHaveLength(0);
  });
  it("reports an ignored remove as unchanged failure", async () => {
    const h = fixture("ignore"); vi.mocked(sendCommand).mockImplementation(async script => h.run(script));
    const tool = (getTransitionsTools({}) as any).remove_transition; expect(tool).toBeDefined();
    expect(await tool.handler({track_index:0,cut_point_seconds:24})).toMatchObject({success:false,data:{timelineChanged:false,mutationOutcome:"not_applied"}});
  });
  it("does not hide a collateral one-tick change beyond numeric precision", async () => {
    const h=fixture();h.transitions.push({...h.transitions[0],nodeId:"other",start:{ticks:"9007199254740992"},end:{ticks:"9007199254740999"}});
    h.transitions[0].remove.mockImplementation(()=>{h.transitions.splice(0,1);h.transitions[0].start.ticks="9007199254740993";});
    vi.mocked(sendCommand).mockImplementation(async script=>h.run(script));
    expect(await (getTransitionsTools({}) as any).remove_transition.handler({track_index:0,transition_index:0})).toMatchObject({success:false,data:{verified:false,timelineChanged:true,outcome:"committed_unverified"}});
  });
  it("reports unknown state when readback becomes unavailable after the write", async () => {
    const h=fixture();h.transitions[0].remove.mockImplementation(()=>{Object.defineProperty(h.track,"transitions",{get(){throw Error("unreadable");}});});
    vi.mocked(sendCommand).mockImplementation(async script=>h.run(script));
    expect(await (getTransitionsTools({}) as any).remove_transition.handler({track_index:0,transition_index:0})).toMatchObject({success:false,data:{timelineChanged:null,mutationOutcome:"unknown",verified:false}});
  });
  it("refuses ambiguous cuts and invalid arguments without removing anything", async () => {
    const h = fixture(); h.transitions.push({...h.transitions[0],nodeId:"other"});
    vi.mocked(sendCommand).mockImplementation(async script => h.run(script));
    const tool = (getTransitionsTools({}) as any).remove_transition; expect(tool).toBeDefined();
    expect(await tool.handler({track_index:0,cut_point_seconds:24})).toMatchObject({success:false});
    expect(h.transitions).toHaveLength(2); vi.mocked(sendCommand).mockClear();
    expect(await tool.handler({track_index:-1,transition_index:0})).toMatchObject({success:false}); expect(sendCommand).not.toHaveBeenCalled();
  });
});
