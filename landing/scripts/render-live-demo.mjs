import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = path.join(root, 'artifacts/demo-recording')
const out = path.join(root, 'landing/public')
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const receipt = JSON.parse(readFileSync(path.join(dir, 'receipts.json'), 'utf8')).find(r => r.name === 'verify_and_save')?.result
if (!receipt?.success || receipt.data.clips.length !== 3 || receipt.data.markers.length !== 3 || !receipt.data.saved) {
  throw new Error('A successful live recording receipt is required before rendering')
}
copyFileSync('C:/Windows/Fonts/segoeui.ttf', path.join(dir, 'regular.ttf'))
copyFileSync('C:/Windows/Fonts/segoeuib.ttf', path.join(dir, 'bold.ttf'))
const text = (value, x, y, size, color='white', extra='') =>
  `drawtext=fontfile=regular.ttf:text='${value}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}${extra}`
const bold = (value, x, y, size, color='white', extra='') =>
  text(value,x,y,size,color,extra).replace('regular.ttf','bold.ttf')
const box = (x,y,w,h,color) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`
const encode = (inputs, filters, duration, filename) => execFileSync(ffmpeg, [
  '-hide_banner','-loglevel','error','-y',...inputs,'-vf',[...filters,'setsar=1','setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'].join(','),'-t',String(duration),
  '-r','30','-an','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',filename,
], {cwd:dir,stdio:'inherit'})

encode(['-i','01 - Coast sunrise.mp4'], [
  'scale=1920:1080',box(0,0,1920,1080,'black@0.48'),
  text('MCP FOR ADOBE PREMIERE PRO',100,84,25,'0xc4b5fd'),
  bold('One request.',100,230,86),bold('A timeline you can review.',100,334,76),
  box(100,515,6,194,'0xbca5ff'),
  text('Assemble these three coastal shots into a 15-second edit.',132,532,36),
  text('Add a review marker at each cut. Save the project.',132,593,36),
  text('REAL PREMIERE SESSION  /  ORIGINAL SAMPLE ARTWORK',100,951,23,'0xe4e4e7'),
], 4, 'intro.mp4')

const body = [
  'trim=duration=25','setpts=PTS-STARTPTS','tpad=stop_mode=clone:stop_duration=3','scale=1920:1028','pad=1920:1080:0:52:color=0x09090d',
  box(0,0,1920,52,'0x09090d'),text('premiere-pro-mcp',28,11,23),
  text('LIVE PREMIERE CAPTURE',1515,15,18,'0xc4b5fd'),
  box(0,91,694,562,'0x101014'),box(1366,91,554,562,'0x101014'),
  text('THE REQUEST',56,136,23,'0xc4b5fd'),
  bold('Build a 15-second',56,205,43),bold('coastal edit.',56,263,43),
  text('Three shots, in order.',56,364,31,'0xd4d4d8'),
  text('A review marker at each cut.',56,416,31,'0xd4d4d8'),
  text('Save the Premiere project.',56,468,31,'0xd4d4d8'),
  text('Original sample artwork',56,598,20,'0xa1a1aa'),
]
for (const [start,end,num,title,lines] of [
  [0,5,'01','Import the media',['Three coastal clips.','Five seconds each.']],
  [5,9,'02','Assemble the edit',['A named sequence.','Clips placed in order.']],
  [9,12,'03','Add review notes',['Opening. Middle. Close.','Markers at each cut.']],
  [12,25,'04','Inspect the result',['Move through each shot.','Review the native timeline.']],
]) {
  const enabled = `:enable='gte(t,${start})*lt(t,${end})'`
  body.push(bold(num,1412,165,88,'0xc4b5fd',enabled),
    bold(title,1412,306,32,'white',enabled),
    text(lines[0],1412,378,26,'0xd4d4d8',enabled),
    text(lines[1],1412,424,26,'0xd4d4d8',enabled))
}
encode(['-i','premiere-live-raw.mp4'],body,25,'body.mp4')
encode(['-i','03 - Blue hour.mp4'],[
  'scale=1920:1080',box(0,0,1920,1080,'black@0.55'),
  text('VERIFIED IN PREMIERE PRO',100,104,25,'0xc4b5fd'),
  bold('Ready for your review.',100,310,86),
  text('3 clips   /   15 seconds   /   3 review markers',105,466,42),
  text('Saved as an editable Premiere project.',105,551,35,'0xe4e4e7'),
  text('premiere-pro-mcp.com',105,936,29),
],5,'outro.mp4')
writeFileSync(path.join(dir,'concat.txt'),"file 'intro.mp4'\nfile 'body.mp4'\nfile 'outro.mp4'\n")
const output = path.join(out,'premiere-pro-mcp-demo-live-v2.mp4')
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i','concat.txt','-c','copy','-movflags','+faststart',output],{cwd:dir,stdio:'inherit'})
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-ss','22','-i',output,'-frames:v','1',path.join(dir,'poster.png')],{cwd:dir,stdio:'inherit'})
for (const width of [640,1280]) {
  await sharp(path.join(dir,'poster.png')).resize(width).webp({quality:44,effort:6}).toFile(path.join(out,`premiere-pro-mcp-demo-live-v2-poster-${width}.webp`))
}
console.log(output)
