import {beforeEach,expect,it,vi} from "vitest";
import {runInNewContext} from "node:vm";
import {parse} from "acorn";
vi.mock("../../src/bridge/file-bridge.js",()=>({sendCommand:vi.fn()}));
import {sendCommand} from "../../src/bridge/file-bridge.js";
import {getHelpersSource} from "../../src/bridge/script-builder.js";
import {getExportTools} from "../../src/tools/export.js";
const target='/tmp/OMF "quoted".omf';
function host(before:number|null,after:number|null){let size=before,stamp=1;const outputs:string[]=[];
 function File(this:any,path:string){this.fsName=path;this.parent={exists:true,fsName:'/tmp'};Object.defineProperties(this,{exists:{get:()=>size!==null},length:{get:()=>size??0},modified:{get:()=>String(stamp)}});}
 vi.mocked(sendCommand).mockImplementation(async(script)=>{parse(script,{ecmaVersion:3,allowReserved:'never'});return JSON.parse(String(runInNewContext(getHelpersSource()+'\n'+script,{File,app:{project:{activeSequence:{},exportOMF:(_seq:unknown,path:string)=>{outputs.push(path);size=after;if(after!==before)stamp++;}}}})));});return outputs;}
beforeEach(()=>vi.clearAllMocks());
it('rejects a newly created empty OMF',async()=>{host(null,0);expect(await getExportTools({}).export_omf.handler({output_path:target})).toMatchObject({success:false});});
it('rejects a stale pre-existing OMF',async()=>{host(42,42);expect(await getExportTools({}).export_omf.handler({output_path:target})).toMatchObject({success:false,error:expect.stringContaining('pre-existing')});});
it('verifies a non-empty changed OMF and escapes its path',async()=>{const outputs=host(null,42);expect(await getExportTools({}).export_omf.handler({output_path:target})).toMatchObject({success:true,data:{exported:true,verified:true}});expect(outputs).toEqual([target]);});
it('rejects an ignored OMF write',async()=>{host(null,null);expect(await getExportTools({}).export_omf.handler({output_path:target})).toMatchObject({success:false});});
