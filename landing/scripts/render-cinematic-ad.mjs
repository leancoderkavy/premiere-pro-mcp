import {execFileSync} from 'node:child_process'
import {copyFileSync, mkdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const work=path.join(root,'artifacts/ad-production')
const demo=path.join(root,'artifacts/demo-recording')
const ff=process.env.FFMPEG_PATH || 'ffmpeg'
mkdirSync(work,{recursive:true})
copyFileSync('C:/Windows/Fonts/segoeui.ttf',path.join(work,'regular.ttf'))
copyFileSync('C:/Windows/Fonts/segoeuib.ttf',path.join(work,'bold.ttf'))
const verified=JSON.parse(readFileSync(path.join(demo,'receipts.json'),'utf8')).find(x=>x.name==='verify_and_save')
if(!verified?.result?.success)throw Error('Real-host verification receipt required')
const run=(args)=>execFileSync(ff,['-hide_banner','-loglevel','error','-y',...args],{cwd:work,stdio:'inherit'})
const accent='0xc1b1ff', white='0xf5f4f0', muted='0xbab8c4'
const box=(x,y,w,h,c)=>`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${c}:t=fill`
const txt=(s,x,y,size,{bold=false,color=white,enable,delay=0,move=true}={})=>{
  const alpha=`if(lt(t,${delay}),0,min(1,(t-${delay})/0.35))`
  const yy=move?`${y}+24*pow(max(0,1-(t-${delay})/0.65),3)`:String(y)
  return `drawtext=fontfile=${bold?'bold':'regular'}.ttf:text='${s}':fontsize=${size}:fontcolor=${color}:x=${x}:y='${yy}':alpha='${alpha}'${enable?`:enable='${enable}'`:''}`
}
const raw=path.join(demo,'premiere-live-raw.mp4')
const coast=path.join(demo,'01 - Coast sunrise.mp4')
const ocean=path.join(demo,'03 - Blue hour.mp4')
const durations=[3.6,6.6,1.5,1.6,2.5,5,3.2,6]
const formats=process.env.AD_FORMAT?[process.env.AD_FORMAT]:['landscape','vertical']
for(const format of formats){
  const vertical=format==='vertical'
  const W=vertical?1080:1920,H=vertical?1920:1080,L=vertical?180:112
  const tagY=vertical?245:92
  const common=[`setsar=1`,`fps=30`,`format=yuv420p`,`setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`]
  const names=[]
  for(let scene=0;scene<8;scene++){
    const d=durations[scene]+(scene<7?.2:0)
    let inputs=[],f=[]
    const source=scene===7?ocean:coast
    const fill=`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
    const flat=()=>{inputs=['-f','lavfi','-i',`color=c=0x08090d:s=${W}x${H}:r=30:d=${d}`]}
    if([0,6,7].includes(scene)){
      inputs=['-stream_loop','-1','-i',source]
      f=[fill,box(0,0,W,H,scene===7?'black@0.68':'black@0.38')]
      if(scene===0){
        f.push(txt('FOR THE STORY YOU SEE',L,tagY,vertical?22:25,{color:accent}),
          txt('You see',L,vertical?580:355,vertical?90:106,{bold:true,enable:'lt(t,1.9)'}),
          txt('the story.',L,vertical?695:475,vertical?90:106,{bold:true,enable:'lt(t,1.9)',delay:.18}),
          txt('Give it',L,vertical?580:355,vertical?90:106,{bold:true,enable:'gte(t,1.9)',delay:1.9}),
          txt('direction.',L,vertical?695:475,vertical?90:106,{bold:true,enable:'gte(t,1.9)',delay:2.04}))
      } else if(scene===6){
        f.push(txt('CREATIVE CONTROL',L,tagY,vertical?24:25,{color:accent}),
          txt('You direct.',L,vertical?590:330,vertical?85:116,{bold:true}),
          txt('You decide.',L,vertical?710:470,vertical?85:116,{bold:true,color:accent,delay:1.08}))
      } else {
        f.push(txt('MCP',L,vertical?430:220,vertical?140:150,{bold:true,color:accent}),
          txt('for Adobe',L,vertical?630:410,vertical?62:70,{bold:true,delay:.14}),
          txt('Premiere Pro',L,vertical?715:498,vertical?62:70,{bold:true,delay:.25}),
          box(L,vertical?920:660,vertical?680:750,2,'0xc1b1ff@0.5'),
          txt('Explore the workflow.',L,vertical?975:718,vertical?41:43,{delay:.5}),
          txt('premiere-pro-mcp.com',L,vertical?1085:803,vertical?39:38,{color:accent,delay:.65}),
          txt('OPEN SOURCE  /  LOCAL WORKFLOW',L,vertical?1220:918,vertical?22:22,{color:muted,delay:.8}))
      }
    }else if(scene===1){
      flat()
      const cx=L,cy=vertical?770:420,cw=vertical?720:1696,ch=vertical?440:385
      f.push(box(vertical?160:92,cy-20,cw+40,ch+40,'0x161320'),box(cx,cy,cw,ch,'0x101118'),
        txt('MCP FOR ADOBE PREMIERE PRO',L,tagY,vertical?24:25,{color:accent}),
        txt('From a request',L,vertical?440:205,vertical?69:90,{bold:true}),
        txt('to a real edit.',L,vertical?535:308,vertical?69:90,{bold:true,color:accent,delay:.17}),
        txt('YOUR DIRECTION',cx+32,cy+35,vertical?23:23,{color:muted,delay:1.8}),
        txt(vertical?'Assemble three':'Assemble three coastal shots.',cx+32,cy+100,vertical?47:53,{bold:true,delay:2.1}),
        ...(vertical?[txt('coastal shots.',cx+32,cy+168,47,{bold:true,delay:2.23})]:[]),
        txt('Add review markers.',cx+32,cy+(vertical?260:184),vertical?41:45,{delay:2.7}),
        txt('Save the project.',cx+32,cy+(vertical?325:250),vertical?41:45,{delay:3.25}))
      // A moving accent is a graphic cue, not simulated application state.
      f.push(`drawbox=x=${L}:y=${cy+ch-4}:w=${cw}:h=4:color=0xc1b1ff@0.25:t=fill`)
    } else {
      const start=[0,0,5.2,8.4,13,18.5][scene]
      inputs=['-ss',String(start),'-i',raw]
      if(scene===2 || scene===3){
        const paneW=vertical?720:1696,paneH=vertical?365:540,py=vertical?730:380
        f.push('crop=1220:380:530:610',`scale=${paneW}:${paneH}:force_original_aspect_ratio=decrease`,
          `pad=${W}:${H}:${L}:${py}:color=0x08090d`)
        const title=scene===2?'Assemble.':'Annotate.'
        f.push(txt('REAL PREMIERE CAPTURE',L,tagY,vertical?23:25,{color:accent}),
          txt(title,L,vertical?470:205,vertical?87:100,{bold:true}),
          txt(scene===2?'Three shots. One sequence.':'Review markers at each cut.',L,vertical?620:326,vertical?35:37,{color:muted}))
      }else if(scene===4){
        f.push('crop=656:410:692:62',`scale=${vertical?720:1250}:-2`,
          `pad=${W}:${H}:${vertical?180:558}:${vertical?670:230}:color=0x08090d`)
        f.push(txt('REAL PREMIERE CAPTURE',L,tagY,vertical?23:25,{color:accent}),
          txt('Inspect',L,vertical?415:320,vertical?84:78,{bold:true}),
          txt('every cut.',L,vertical?525:415,vertical?84:78,{bold:true,color:accent,delay:.12}))
      }else{
        // Native program + timeline, tightly framed so the edit stays legible.
        f.push('crop=1250:940:520:40',`scale=${vertical?720:1070}:-2`,
          `pad=${W}:${H}:${vertical?180:760}:${vertical?620:190}:color=0x08090d`)
        f.push(txt('AN EDIT YOU CAN REVIEW',L,tagY,vertical?23:25,{color:accent}),
          txt(vertical?'Your timeline.':'Your',L,vertical?410:320,vertical?70:93,{bold:true}),
          txt(vertical?'Your control.':'timeline.',L,vertical?507:420,vertical?70:93,{bold:true,color:accent,delay:.16}))
        if(!vertical) f.push(txt('Editable in',L,594,41,{delay:1.1}),txt('Premiere Pro.',L,648,41,{delay:1.2}),txt('3 CLIPS  /  15 SECONDS',L,792,23,{color:muted,delay:2.1}))
      }
    }
    const name=`${format}-${scene}.mp4`;names.push(name)
    run([...inputs,'-vf',['setpts=PTS-STARTPTS',...f,`tpad=stop_mode=clone:stop_duration=8`,...common].join(','),'-t',String(d),'-an','-c:v','libx264','-preset','fast','-crf','18',name])
    console.log(`${format} scene ${scene+1}/8`)
  }
  let filters=[],offset=0,prev='0:v'
  for(let i=1;i<8;i++){
    offset+=durations[i-1]
    const name=`x${i}`
    filters.push(`[${prev}][${i}:v]xfade=transition=fade:duration=0.2:offset=${offset.toFixed(3)}[${name}]`)
    prev=name
  }
  run([...names.flatMap(n=>['-i',n]),'-filter_complex',filters.join(';'),'-map',`[${prev}]`,'-t','30','-an','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',`${format}-picture.mp4`])
}
console.log('Picture masters ready')
