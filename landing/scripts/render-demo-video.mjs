import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.join(root, "video-src", "demo.html")
const frames = path.join(root, ".demo-frames")
const output = path.join(root, "public", "premiere-pro-mcp-demo.mp4")
const poster = path.join(root, "public", "premiere-pro-mcp-demo-poster.png")
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const total = 120

rmSync(frames, { recursive: true, force: true })
mkdirSync(frames, { recursive: true })

for (let frame = 0; frame < total; frame += 1) {
  const screenshot = path.join(frames, `${String(frame).padStart(4, "0")}.png`)
  const url = `file://${source}?frame=${frame}&total=${total}`
  execFileSync(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
    "--window-size=1280,720",
    `--screenshot=${screenshot}`,
    url,
  ], { stdio: "ignore" })
}

execFileSync("ffmpeg", [
  "-y",
  "-framerate", "12",
  "-i", path.join(frames, "%04d.png"),
  "-vf", "fps=24,format=yuv420p",
  "-c:v", "libx264",
  "-preset", "slow",
  "-crf", "20",
  "-movflags", "+faststart",
  output,
], { stdio: "inherit" })

execFileSync("ffmpeg", [
  "-y",
  "-i", output,
  "-ss", "00:00:08.5",
  "-frames:v", "1",
  poster,
], { stdio: "ignore" })

rmSync(frames, { recursive: true, force: true })
console.log(`Rendered ${output}`)
