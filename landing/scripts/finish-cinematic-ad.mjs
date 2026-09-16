import {execFileSync,spawnSync} from 'node:child_process'
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const dir=path.join(root,'artifacts/ad-production')
const pub=path.join(root,'landing/public')
const ff=process.env.FFMPEG_PATH || 'ffmpeg'
copyFileSync(path.join(root,'landing/video-src/audio/premiere-ad-v3-narration.mp3'),path.join(dir,'narration-original.mp3'))
const run=args=>execFileSync(ff,['-hide_banner','-y',...args],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024})
run(['-loglevel','error','-i','narration-original.mp3','-af','atempo=0.92,highpass=f=75,lowpass=f=12500,loudnorm=I=-18:TP=-2:LRA=7,aresample=48000,aformat=channel_layouts=stereo,adelay=650|650,apad','-t','30','-ar','48000','-c:a','pcm_s24le','voice-stem.wav'])
run(['-loglevel','error','-i','score-original.wav','-af','loudnorm=I=-21:TP=-4:LRA=9,aresample=48000,volume=0.72,afade=t=in:d=0.5,afade=t=out:st=28:d=2','-ar','48000','-c:a','pcm_s24le','music-stem.wav'])
const mix=[
  '[0:a]asplit=2[voice][key]',
  '[1:a]anull[music]',
  '[music][key]sidechaincompress=threshold=0.025:ratio=4:attack=12:release=300[ducked]',
  '[2:a]volume=0.8[sfx]',
  '[voice][ducked][sfx]amix=inputs=3:normalize=0:duration=longest,atrim=duration=30[mix]',
].join(';')
run(['-loglevel','error','-i','voice-stem.wav','-i','music-stem.wav','-i','sound-design.wav','-filter_complex',mix,'-map','[mix]','-ar','48000','-c:a','pcm_s24le','premaster.wav'])
const measured=spawnSync(ff,['-hide_banner','-i','premaster.wav','-af','loudnorm=I=-16:TP=-1:LRA=9:print_format=json','-f','null','-'],{cwd:dir,encoding:'utf8'})
if(measured.status!==0)throw Error(measured.stderr)
const analysis=measured.stderr
const levels=JSON.parse(analysis.slice(analysis.lastIndexOf('{'),analysis.lastIndexOf('}')+1))
writeFileSync(path.join(dir,'mix-measurement.json'),JSON.stringify(levels,null,2))
run(['-loglevel','error','-i','premaster.wav','-af',`loudnorm=I=-16:TP=-1:LRA=9:measured_I=${levels.input_i}:measured_TP=${levels.input_tp}:measured_LRA=${levels.input_lra}:measured_thresh=${levels.input_thresh}:offset=${levels.target_offset}:linear=true,aresample=48000`,'-c:a','pcm_s24le','ad-mix-master.wav'])

const words=JSON.parse(readFileSync(path.join(dir,'narration-timing.json'),'utf8')).flatMap(s=>s.words)
const cues=[];let current=[]
for(const w of words){
  current.push(w)
  if(/[.!?]$/.test(w.word)||current.map(x=>x.word).join('').length>34||current.length>=7){
    cues.push({start:current[0].start/.92+.65,end:current.at(-1).end/.92+.85,text:current.map(x=>x.word).join('').trim()});current=[]
  }
}
if(current.length)cues.push({start:current[0].start/.92+.65,end:current.at(-1).end/.92+.85,text:current.map(x=>x.word).join('').trim()})
for(let i=0;i<cues.length-1;i++) cues[i].end=Math.min(cues[i].end,cues[i+1].start)
const vttTime=s=>`00:${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`
writeFileSync(path.join(pub,'premiere-pro-mcp-ad-v3.vtt'),'WEBVTT\n\n'+cues.map(c=>`${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n'))
const assTime=s=>`0:${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`
for(const format of ['landscape','vertical']){
  const vertical=format==='vertical',w=vertical?1080:1920,h=vertical?1920:1080
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI,${vertical?43:38},&H00FFFFFF,&H00FFFFFF,&H00101016,&H90000000,-1,0,0,0,100,100,0,0,1,2,1,2,${vertical?185:140},${vertical?185:140},${vertical?550:54},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  const events=cues.map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text}`).join('\n')
  writeFileSync(path.join(dir,`${format}-captions.ass`),header+events)
  const file=vertical?'premiere-pro-mcp-ad-v3-vertical.mp4':'premiere-pro-mcp-ad-v3.mp4'
  run(['-loglevel','error','-i',`${format}-picture.mp4`,'-i','ad-mix-master.wav','-vf',`ass=${format}-captions.ass`,'-map','0:v','-map','1:a','-t','30','-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','256k','-ar','48000','-movflags','+faststart',path.join(pub,file)])
  console.log(file)
}
run(['-loglevel','error','-ss','16.8','-i',path.join(pub,'premiere-pro-mcp-ad-v3.mp4'),'-frames:v','1','ad-poster.png'])
for(const width of [640,1280]){
  await sharp(path.join(dir,'ad-poster.png')).resize(width).webp({quality:65,effort:6}).toFile(path.join(pub,`premiere-pro-mcp-ad-v3-poster-${width}.webp`))
}
console.log('Captioned picture and stereo mix complete')
