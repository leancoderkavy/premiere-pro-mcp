"use client"

import { Box, Pause, Play, Scan, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react"
import { useState, type ReactNode } from "react"
import { cinemaChapters } from "./cinema-content"
import { timecode } from "./cinema-interaction"
import { clipNames } from "./cinema-sequence"
import type { CinemaEditor } from "./cinema-editor"

export function CinemaMonitor({
  editor,
  cinematic,
  onCinematic,
  children
}: {
  editor: CinemaEditor
  cinematic: boolean
  onCinematic: () => void
  children: ReactNode
}) {
  const [safe, setSafe] = useState(false)
  const [zoom, setZoom] = useState("fit")
  const { frame, duration, activeShot, playing } = editor
  const active = editor.sequence.clips.find((clip) => clip.shot === activeShot)
  const sourceFrame = active ? active.sourceIn + frame - active.start : null
  return (
    <section
      className="cinema-program-monitor"
      aria-label="Program monitor"
      data-view={cinematic ? "cinematic" : "program"}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches("input, select, button")) return
        if (event.code === "Space") {
          event.preventDefault()
          editor.toggle()
        } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault()
          editor.seek(frame + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 24 : 1))
        }
      }}
    >
      <header className="program-panel-header">
        <h2>
          <span>Program:</span> Pacific
        </h2>
        <div>
          <span className="program-demo-tag">ILLUSTRATED DEMO</span>
          <span className="program-panel-grip" aria-hidden="true">
            ⠿
          </span>
        </div>
      </header>
      <div
        className="program-picture-well"
        tabIndex={0}
        aria-label="Program picture. Space to play or pause; arrow keys step frames."
        data-gap={activeShot === null}
      >
        {cinematic ? (
          children
        ) : activeShot !== null ? (
          <div
            className="program-picture"
            data-shot={activeShot}
            data-source-frame={sourceFrame}
            data-zoom={zoom}
            role="img"
            aria-label={`Program frame: ${clipNames[activeShot]}`}
          >
            <div className="program-picture-image" />
            {safe ? (
              <div className="program-safe-margins" aria-hidden="true">
                <i />
                <b>+</b>
              </div>
            ) : null}
          </div>
        ) : null}
        {activeShot === null ? (
          <div className="cinema-gap">
            <strong>NO PICTURE</strong>
            <span>Move a clip here to fill the gap.</span>
          </div>
        ) : null}
        <span className="program-picture-label" aria-hidden="true">
          {active ? `V${active.track + 1} / SHOT ${cinemaChapters[active.shot].shot}` : "GAP"}
        </span>
      </div>
      <div className="program-readouts">
        <output className="cinema-timecode" aria-label="Current timecode" aria-live="off">
          {timecode(frame)}
        </output>
        <label className="program-fit">
          <span className="sr-only">Monitor magnification</span>
          <select
            aria-label="Monitor magnification"
            value={zoom}
            disabled={cinematic}
            onChange={(event) => setZoom(event.currentTarget.value)}
          >
            <option value="fit">Fit</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
          </select>
        </label>
        <span className="program-source-time" aria-label="Source timecode">
          {sourceFrame === null ? "—" : `SRC ${timecode(sourceFrame)}`}
        </span>
        <span className="program-frame-rate">24 FPS</span>
        <span className="cinema-duration" aria-label="Sequence duration">
          / {timecode(duration)}
        </span>
      </div>
      <div className="program-jog">
        <input
          type="range"
          min={0}
          max={duration - 1}
          step={1}
          value={frame}
          aria-label="Program monitor playhead"
          aria-valuetext={timecode(frame)}
          onChange={(event) => editor.seek(Number(event.currentTarget.value))}
        />
      </div>
      <div className="program-controls">
        <span className="program-clip-name">
          {activeShot === null ? "Empty frame" : clipNames[activeShot]}
        </span>
        <div className="program-transport" role="group" aria-label="Monitor playback controls">
          <button
            type="button"
            onClick={() => editor.seek(0)}
            aria-label="Return to first frame"
            title="First frame"
          >
            <SkipBack size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor.seek(frame - 1)}
            disabled={frame === 0}
            aria-label="Step back one frame"
            title="Previous frame"
          >
            <StepBack size={16} />
          </button>
          <button
            type="button"
            className="program-play"
            onClick={editor.toggle}
            aria-label={
              playing
                ? "Pause sequence"
                : frame === duration - 1
                  ? "Replay sequence"
                  : "Play sequence"
            }
            aria-pressed={playing}
          >
            {playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            onClick={() => editor.seek(frame + 1)}
            disabled={frame === duration - 1}
            aria-label="Step forward one frame"
            title="Next frame"
          >
            <StepForward size={16} />
          </button>
          <button
            type="button"
            onClick={() => editor.seek(duration - 1)}
            aria-label="Go to last frame"
            title="Last frame"
          >
            <SkipForward size={15} />
          </button>
        </div>
        <div className="program-view-controls">
          <button
            type="button"
            onClick={() => setSafe((value) => !value)}
            disabled={cinematic}
            aria-pressed={safe}
            aria-label="Safe margins"
            title="Safe margins"
          >
            <Scan size={16} />
          </button>
          <button
            type="button"
            onClick={onCinematic}
            aria-pressed={cinematic}
            aria-label="3D overview"
            title={cinematic ? "Return to program picture" : "Show 3D overview"}
          >
            <Box size={16} />
            <span>3D</span>
          </button>
        </div>
      </div>
      <p className="cinema-caption sr-only" aria-live="polite">
        {activeShot === null ? "No picture at the playhead." : cinemaChapters[activeShot].title}
      </p>
    </section>
  )
}
