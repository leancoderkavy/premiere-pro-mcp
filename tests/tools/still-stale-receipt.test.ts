import {expect,it,vi} from 'vitest';import {parse} from 'acorn';import {runInNewContext} from 'node:vm';import {getHelpersSource} from '../../src/bridge/script-builder.js';
it.each(['ignored','throws'])('refuses a stale still whose removal is %s before native export',mode=>{
 const exportFramePNG=vi.fn();function File(this:any,path:string){this.fsName=path;this.exists=path==='/tmp/frame.png';this.length=this.exists?32:0;this.remove=()=>{if(mode==='throws')throw Error('read only');return false;};}
 const source=getHelpersSource();parse(source,{ecmaVersion:3,allowReserved:'never'});const result=runInNewContext(source+'\n__exportStillFrame("/tmp/frame.png","0");',{File,app:{project:{activeSequence:{}},enableQE:()=>{}},qe:{project:{getActiveSequence:()=>({exportFramePNG})}}});expect(result).toMatchObject({ok:false,error:expect.stringContaining('existing still')});expect(exportFramePNG).not.toHaveBeenCalled();
});
