import {parse} from 'acorn';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';
vi.mock('../../src/bridge/file-bridge.js',()=>({sendCommand:vi.fn()}));
import {sendCommand} from '../../src/bridge/file-bridge.js';
import {getHelpersSource} from '../../src/bridge/script-builder.js';
import {getTimelineTools} from '../../src/tools/timeline.js';
import {createHost2652,HostTime} from '../helpers/premiere-26-5-2.js';
function fixture(rate:number,mode:string,whole=false){
 const h=createHost2652(),item=h.addItem({hasVideo:false,sampleRate:rate,durationSeconds:15});
 const originalIn=item.setInPoint.bind(item),originalOut=item.setOutPoint.bind(item);
 for(const [edge,original] of [['In',originalIn],['Out',originalOut]] as const)item[`set${edge}Point`]=(seconds:number,type:number)=>{
  if(mode==='ignored')return;
  if(mode==='coarse96k')seconds=(Math.floor(seconds*96000)+.25)/96000;
  if(mode==='coarse48k')seconds=(Math.floor(seconds*48000)+.25)/48000;
  if(mode==='decimal')seconds=Math.floor(seconds*1e6)/1e6;
  original(seconds,mode==='type4'?4:type);
 };
 const clip=h.addClip(item,{mediaType:'Audio',inSeconds:whole?0:1.001-1/rate,durationSeconds:whole?15:3.003,linked:false});
 h.addClip(item,{mediaType:'Audio',trackIndex:1,durationSeconds:1}).remove();
 vi.mocked(sendCommand).mockImplementation(async script=>{parse(script,{ecmaVersion:3,allowReserved:'never'});return JSON.parse(String(runInNewContext(getHelpersSource()+'\n'+script,{app:h.app,Time:HostTime})));});
 return {h,item,clip,tool:getTimelineTools({tempDir:'/tmp/high-rate-clock'}).duplicate_clip};
}
it.each(['native','coarse48k','coarse96k','decimal','type4','ignored'])('refuses unconfirmed high-rate temporary marks before any write: %s',async mode=>{
 const {h,item,clip,tool}=fixture(384000,mode);const before=[item.getInPoint(2).ticks,item.getOutPoint(2).ticks];
 expect(await tool.handler({node_id:clip.nodeId})).toMatchObject({success:false,data:{mutationOutcome:'not_applied',timelineChanged:false,code:'SOURCE_MARK_CLOCK_UNCONFIRMED',survivingCopyIds:[]}});
 expect(item.markWrites).toHaveLength(0);expect(h.audio).toHaveLength(1);expect([item.getInPoint(2).ticks,item.getOutPoint(2).ticks]).toEqual(before);
});
it.each([96000,192000,384000])('duplicates unchanged whole marks without setter roundtrip at %s Hz',async rate=>{
 const {item,clip,tool}=fixture(rate,'ignored',true);expect(await tool.handler({node_id:clip.nodeId})).toMatchObject({success:true,data:{verified:true,marksRestored:true}});expect(item.markWrites).toHaveLength(0);
});
it('refuses invalid source identity before mark writes',async()=>{const {item,tool}=fixture(384000,'native');expect(await tool.handler({node_id:'missing"\n'})).toMatchObject({success:false});expect(item.markWrites).toHaveLength(0);});

it('reports every surviving high-rate copy if the host unexpectedly changes marks during placement',async()=>{
 const {h,item,clip,tool}=fixture(384000,'native',true);
 const {observeHostOverwrite}=await import('../helpers/premiere-26-5-2.js');
 observeHostOverwrite(h,()=>item.setInPoint(1+.25/384000,2));
 const r=await tool.handler({node_id:clip.nodeId});const copies=h.audio.filter(c=>c.nodeId!==clip.nodeId).map(c=>c.nodeId);
 expect(copies).toHaveLength(1);expect(r).toMatchObject({success:false,data:{marksRestored:false,timelineChanged:true,survivingCopyIds:copies}});
});
it('a 96 kHz write grid reproduces the recorded three-sample restoration drift',()=>{
 const {item}=fixture(384000,'native');
 item.setInPoint((254078842500+165375)/254016000000,2);item.setOutPoint((1016318016000+165375)/254016000000,2);
 const originalIn=item.setInPoint.bind(item),originalOut=item.setOutPoint.bind(item);
 item.setInPoint=(seconds:number,type:number)=>originalIn((Math.floor(seconds*96000)+.25)/96000,type);
 item.setOutPoint=(seconds:number,type:number)=>originalOut((Math.floor(seconds*96000)+.25)/96000,type);
 const r=runInNewContext(getHelpersSource()+`\n(function(){var original=__itemMarksForRestore(item,2);return {restored:__restoreItemMarks(item,original,2),wanted:original.inTicks,got:String(item.getInPoint(2).ticks)};})()`,{item});
 expect(r).toMatchObject({restored:false,wanted:'254078842500',got:'254076858000'});
});
