import {parse} from 'acorn';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';
vi.mock('../../src/bridge/file-bridge.js',()=>({sendCommand:vi.fn()}));
vi.mock('../../src/tools/media-evidence.js',()=>({probeMediaDurationTicks:vi.fn().mockResolvedValue(15*254016000000)}));
import {sendCommand} from '../../src/bridge/file-bridge.js';
import {getHelpersSource} from '../../src/bridge/script-builder.js';
import {getTimelineTools} from '../../src/tools/timeline.js';
import {getSourceMonitorTools} from '../../src/tools/source-monitor.js';
import {createHost2652,HostTime} from '../helpers/premiere-26-5-2.js';
const T=254016000000;
for(const rate of [44100,48000,96000,192000,384000]){
 function setup(){const h=createHost2652(),item=h.addItem({hasVideo:false,sampleRate:rate,durationSeconds:15,soft:true,softInSeconds:1,softOutSeconds:4});const execute=(body:string)=>runInNewContext(getHelpersSource()+'\n'+body,{app:h.app,qe:h.qe,Time:HostTime,item});vi.mocked(sendCommand).mockImplementation(async script=>{parse(script,{ecmaVersion:3,allowReserved:'never'});return JSON.parse(String(execute(script)));});return {h,item,execute};}
 it('shared overwrite restores inclusive private marks at '+rate+' Hz',()=>{const {item,execute}=setup();const r=execute('(function(){return __overwriteRangeOnTrack(app.project.activeSequence.audioTracks[0],item,"0","'+(2*T)+'","'+(3*T)+'",2,16);})()');expect(r).toMatchObject({ok:true,marksRestored:true});expect(item.getInPoint(2).ticks).toBe(String(T));expect(item.getOutPoint(2).ticks).toBe(String(4*T));});
 it('replace_clip restores private marks at '+rate+' Hz',async()=>{const {h,item}=setup();const old=h.addClip(h.addItem({hasVideo:false,durationSeconds:15,sampleRate:rate}),{mediaType:'Audio',durationSeconds:1,linked:false});expect(await getTimelineTools({tempDir:'/tmp/rate-matrix'}).replace_clip.handler({node_id:old.nodeId,new_item_id:item.nodeId})).toMatchObject({success:true});expect(item.getInPoint(2).ticks).toBe(String(T));expect(item.getOutPoint(2).ticks).toBe(String(4*T));});
 it('Source Monitor failure leaves readable audio marks at '+rate+' Hz',async()=>{const {item}=setup();item.setInPoint=()=>{};item.setOutPoint=()=>{};const r=await getSourceMonitorTools({tempDir:'/tmp/rate-matrix'}).set_source_in_out.handler({in_seconds:2,out_seconds:3});expect(r).toMatchObject({success:false});expect(item.getInPoint(2).ticks).toBe('0');expect(item.getOutPoint(2).ticks).toBe(String(15*T));});
}
