import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sendCommand } from '../../dist/bridge/file-bridge.js'
import { buildToolScript } from '../../dist/bridge/script-builder.js'
import { getMediaTools } from '../../dist/tools/media.js'
import { getAdvancedTools } from '../../dist/tools/advanced.js'
import { getMarkerTools } from '../../dist/tools/markers.js'
import { getPlayheadTools } from '../../dist/tools/playhead.js'

// Run only against the dedicated, empty demo project. Never touch a user's edit.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = path.join(root, 'artifacts/demo-recording')
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const hwnd = process.env.PREMIERE_DEMO_HWND
if (!hwnd || !/^\d+$/.test(hwnd)) throw new Error('Set PREMIERE_DEMO_HWND to the observed Premiere window handle')
mkdirSync(dir, { recursive: true })
const options = { timeoutMs: 15000 }
const receipts = []
async function run(name, fn) {
  const result = await fn()
  receipts.push({ name, at: new Date().toISOString(), result })
  writeFileSync(path.join(dir, 'receipts.json'), JSON.stringify(receipts, null, 2))
  if (!result.success) throw new Error(`${name}: ${JSON.stringify(result)}`)
  console.log(name, JSON.stringify(result))
  return result.data
}
const state = await run('inspect_demo_project', () => sendCommand(buildToolScript(`
  return __result({path:app.project.path, items:app.project.rootItem.children.numItems});
`), options))
const projectPath = path.join(dir, process.env.DEMO_PROJECT_NAME || 'Request to review.prproj')
if (path.dirname(projectPath) !== dir || path.resolve(state.path) !== projectPath || state.items !== 0) {
  throw new Error('Expected the empty, dedicated demo project specified by DEMO_PROJECT_NAME')
}
const shots = ['01 - Coast sunrise', '02 - Forest and sea', '03 - Blue hour']
for (const [i, name] of shots.entries()) {
  if (existsSync(path.join(dir, `${name}.mp4`))) continue
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1',
    '-i', path.join(root, 'landing/public/marketing/cinema-coast-atlas.webp'),
    '-vf', `crop=1536:330:0:${[0, 344, 690][i]},scale=-1:720,crop=1280:720:x='${i === 1 ? '500+20*t' : '180+22*t'}':y=0,setsar=1`,
    '-t', '5', '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    path.join(dir, `${name}.mp4`)], { stdio: 'inherit' })
}
const media = getMediaTools(options)
const advanced = getAdvancedTools(options)
const markers = getMarkerTools(options)
const playhead = getPlayheadTools(options)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const recording = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `gfxcapture=hwnd=${hwnd}:capture_cursor=0:max_framerate=30,hwdownload,format=bgra`,
  '-t', '31', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-movflags', '+faststart',
  path.join(dir, 'premiere-live-raw.mp4')], { stdio: ['pipe', 'ignore', 'inherit'] })
const finished = new Promise((resolve, reject) => {
  recording.on('error', reject)
  recording.on('close', code => code === 0 ? resolve() : reject(new Error(`Capture exited ${code}`)))
})
try {
  await wait(2500)
  await run('import_media', () => media.import_media.handler({file_paths: shots.map(name => path.join(dir, `${name}.mp4`))}))
  await wait(3000)
  await run('create_sequence_from_clips', () => advanced.create_sequence_from_clips.handler({name: 'COAST - 15 second review', item_ids: shots.map(name => `${name}.mp4`)}))
  await wait(3000)
  for (const [i, name] of ['OPEN - establish the coast', 'MIDDLE - forest and sea', 'CLOSE - blue hour'].entries()) {
    await run('add_marker', () => markers.add_marker.handler({time_seconds:i*5, name, comments:'Review this shot and its cut point.', color: 2}))
  }
  await wait(2000)
  for (const seconds of [1, 6, 11, 2]) {
    await run('set_playhead_position', () => playhead.set_playhead_position.handler({time_seconds:seconds}))
    await wait(2800)
  }
  await run('verify_and_save', () => sendCommand(buildToolScript(`
    var s=app.project.activeSequence; var clips=[]; var marks=[];
    for(var i=0;i<s.videoTracks[0].clips.numItems;i++){var c=s.videoTracks[0].clips[i];clips.push({name:c.name,start:c.start.seconds,end:c.end.seconds});}
    var m=s.markers.getFirstMarker();while(m){marks.push({name:m.name,seconds:m.start.seconds});m=s.markers.getNextMarker(m);}
    app.project.save();return __result({sequence:s.name,clips:clips,markers:marks,saved:true});
  `), options))
  // GFX capture emits frames on visual changes. Refresh once beyond the
  // requested duration so an idle saved project cannot leave capture waiting.
  await wait(9000)
  await run('final_review_frame', () => playhead.set_playhead_position.handler({time_seconds:3}))
  await finished
} catch (error) {
  recording.stdin.write('q')
  await finished.catch(() => {})
  throw error
}
console.log(`Recorded ${dir}`)
