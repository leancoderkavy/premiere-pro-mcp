"use client"

import {
  ArrowLeft,
  ArrowRight,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  Undo2,
  Volume2
} from "lucide-react"
import { useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { cinemaChapters } from "./cinema-content"
import { timecode } from "./cinema-interaction"
import { clipNames } from "./cinema-sequence"
import type { CinemaEditor } from "./cinema-editor"

const waveform = Array.from({ length: 110 }, (_, index) => {
  const height = 2 + Math.round(Math.abs(Math.sin(index * 1.83) * Math.cos(index * 0.19)) * 18)
  return `M${index * 6 + 2},${24 - height}v${height * 2}`
}).join(" ")

export function CinemaTimeline({
  editor,
  exploded,
  onExplode
}: {
  editor: CinemaEditor
  exploded: boolean
  onExplode: () => void
}) {
  const { frame, chapter, playing, duration, sequence, busy } = editor
  const index = sequence.clips.findIndex((clip) => clip.shot === chapter)
  const selected = sequence.clips[index]
  const drag = useRef<{
    shot: number
    x: number
    y: number
    moved: boolean
    target: number
  } | null>(null)
  const suppressClick = useRef(false)
  const [dragged, setDragged] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const current = drag.current
    if (current?.moved) {
      suppressClick.current = true
      event.preventDefault()
      if (!cancel && !busy) editor.reorder(current.shot, current.target)
    }
    drag.current = null
    setDragged(null)
    setDropTarget(null)
  }
  return (
    <div className="cinema-editing-desk" data-exploded={exploded}>
      <div className="cinema-transport">
        <div className="cinema-transport-left">
          <button
            type="button"
            className="cinema-play"
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
            className="cinema-rewind"
            onClick={() => editor.seek(0)}
            aria-label="Return to first frame"
          >
            <RotateCcw size={15} />
          </button>
          <output className="cinema-timecode" aria-label="Current timecode" aria-live="off">
            {timecode(frame)}
          </output>
          <span className="cinema-duration" aria-label="Sequence duration">
            / {timecode(duration)}
          </span>
        </div>
        <button
          type="button"
          className="cinema-layers-toggle"
          onClick={onExplode}
          aria-pressed={exploded}
        >
          <Layers3 size={16} />
          <span>{exploded ? "Bring layers together" : "Separate layers"}</span>
        </button>
      </div>
      <div className="cinema-deck-space">
        <div
          className="cinema-deck"
          style={
            {
              "--playhead": `${(frame / (duration - 1)) * 100}%`,
              "--thumb-offset": `${(frame / (duration - 1)) * 16}px`
            } as CSSProperties
          }
        >
          <div className="cinema-deck-header">
            <span>
              <i /> PACIFIC / YOUR EDIT
            </span>
            <span>
              SEQUENCE 01 <b>24 FPS</b>
            </span>
          </div>
          <div className="cinema-tracks">
            <div className="cinema-ruler-row">
              <span className="cinema-track-label">TIME</span>
              <div className="cinema-ruler-scrub">
                <div className="cinema-time-marks" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, mark) => (
                    <span key={mark}>
                      {timecode(Math.round((duration * mark) / 6)).slice(3, 8)}
                    </span>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration - 1}
                  step={1}
                  value={frame}
                  onChange={(event) => editor.seek(Number(event.currentTarget.value))}
                  aria-label="Scrub editing timeline"
                  aria-valuetext={`${timecode(frame)} — ${clipNames[chapter]}`}
                  className="cinema-scrubber"
                />
                <div className="cinema-marker-track" role="group" aria-label="Review markers">
                  {sequence.markers.map((marker, markerIndex) => (
                    <button
                      key={`${marker.frame}-${markerIndex}`}
                      type="button"
                      className="cinema-review-marker"
                      style={{ left: `${(marker.frame / (duration - 1)) * 100}%` }}
                      aria-label={`${marker.name} at ${timecode(marker.frame)}`}
                      title={`${marker.name} · ${timecode(marker.frame)}`}
                      onClick={() => editor.seek(marker.frame)}
                    >
                      <span aria-hidden="true">◆</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="cinema-layer cinema-video-layer">
              <span className="cinema-track-label">
                <b>V1</b>PICTURE
              </span>
              <div
                className="cinema-video-clips"
                style={{
                  gridTemplateColumns: sequence.clips
                    .map((clip) => `minmax(0, ${clip.duration}fr)`)
                    .join(" ")
                }}
              >
                {sequence.clips.map((clip, position) => (
                  <button
                    type="button"
                    className="cinema-clip"
                    data-shot={clip.shot}
                    data-position={position}
                    data-dragging={dragged === clip.shot}
                    data-drop-target={dropTarget === position && dragged !== clip.shot}
                    key={clip.shot}
                    aria-label={`Select clip ${cinemaChapters[clip.shot].shot}: ${clipNames[clip.shot]}`}
                    aria-describedby="cinema-edit-hint"
                    aria-pressed={chapter === clip.shot}
                    onClick={(event) => {
                      if (suppressClick.current && event.detail > 0) {
                        suppressClick.current = false
                        return
                      }
                      editor.selectShot(clip.shot)
                    }}
                    onKeyDown={(event) => {
                      if (
                        !busy &&
                        event.altKey &&
                        ["ArrowLeft", "ArrowRight"].includes(event.key)
                      ) {
                        event.preventDefault()
                        editor.reorder(clip.shot, position + (event.key === "ArrowLeft" ? -1 : 1))
                      }
                    }}
                    onPointerDown={(event) => {
                      suppressClick.current = false
                      if (busy || event.button !== 0) return
                      drag.current = {
                        shot: clip.shot,
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                        target: position
                      }
                      event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                    onPointerMove={(event) => {
                      const current = drag.current
                      if (!current || busy) return
                      if (
                        !current.moved &&
                        Math.hypot(event.clientX - current.x, event.clientY - current.y) < 8
                      )
                        return
                      current.moved = true
                      setDragged(current.shot)
                      const hit = document
                        .elementFromPoint(event.clientX, event.clientY)
                        ?.closest<HTMLButtonElement>(".cinema-clip")
                      if (hit) {
                        current.target = Number(hit.dataset.position)
                        setDropTarget(current.target)
                      }
                    }}
                    onPointerUp={(event) => finishDrag(event)}
                    onPointerCancel={(event) => finishDrag(event, true)}
                  >
                    <span className="cinema-clip-thumb" aria-hidden="true" />
                    <span className="cinema-clip-title">
                      <b>{cinemaChapters[clip.shot].shot}</b>
                      {clipNames[clip.shot]}
                      <small>{timecode(clip.duration).slice(6)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="cinema-layer cinema-color-layer">
              <span className="cinema-track-label">
                <b>FX</b>COLOR
              </span>
              <div className="cinema-color-clip">
                <span>◈</span>
                <span>COASTAL LIGHT</span>
                <i />
                <span>COLOR GRADE</span>
              </div>
            </div>
            <div className="cinema-layer cinema-audio-layer">
              <span className="cinema-track-label">
                <b>A1</b>SOUND
              </span>
              <div className="cinema-audio-clip">
                <span>
                  <Volume2 size={11} /> OCEAN / AMBIENCE
                </span>
                <svg viewBox="0 0 660 48" preserveAspectRatio="none" aria-hidden="true">
                  <path d={waveform} fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
            <div className="cinema-playhead-track" aria-hidden="true">
              <div className="cinema-real-playhead">
                <i />
                <span>{timecode(frame).slice(6)}</span>
              </div>
            </div>
          </div>
          <div className="cinema-deck-bottom">
            <span>
              3 SHOTS <i /> 1 STORY
            </span>
            <span>
              {sequence.markers.length
                ? `${sequence.markers.length} REVIEW MARKER${sequence.markers.length === 1 ? "" : "S"}`
                : "DRAG SHOTS TO REORDER"}
            </span>
          </div>
        </div>
      </div>
      <div className="cinema-clip-inspector" aria-label="Edit the selected clip">
        <div className="cinema-selected-name">
          <span>SELECTED CLIP / {String(index + 1).padStart(2, "0")}</span>
          <strong>{clipNames[chapter]}</strong>
        </div>
        <label className="cinema-trim-control">
          <span>
            Duration <output aria-live="off">{(selected.duration / 24).toFixed(2)}s</output>
          </span>
          <input
            type="range"
            min={48}
            max={192}
            step={1}
            value={selected.duration}
            disabled={busy}
            aria-label="Selected clip duration"
            aria-valuetext={`${(selected.duration / 24).toFixed(2)} seconds`}
            onPointerDown={editor.beginEdit}
            onPointerUp={editor.endEdit}
            onPointerCancel={editor.endEdit}
            onKeyDown={(event) => {
              if (!event.repeat) editor.beginEdit()
            }}
            onKeyUp={editor.endEdit}
            onBlur={editor.endEdit}
            onChange={(event) => editor.resize(chapter, Number(event.currentTarget.value))}
          />
        </label>
        <div className="cinema-edit-actions">
          <button
            type="button"
            disabled={busy || index === 0}
            onClick={() => editor.reorder(chapter, index - 1)}
            aria-label="Move selected clip earlier"
          >
            <ArrowLeft size={15} />
            <span>Earlier</span>
          </button>
          <button
            type="button"
            disabled={busy || index === 2}
            onClick={() => editor.reorder(chapter, index + 1)}
            aria-label="Move selected clip later"
          >
            <ArrowRight size={15} />
            <span>Later</span>
          </button>
          <button
            type="button"
            disabled={busy || !editor.canUndo}
            onClick={editor.undo}
            aria-label="Undo last edit"
          >
            <Undo2 size={15} />
            <span>Undo</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={editor.reset}
            aria-label="Reset demo sequence"
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>
      <p className="cinema-interaction-hint">
        <span>Drag the playhead</span>
        <i /> Drag shots to reorder
        <i />
        <span>Adjust duration below the timeline</span>
      </p>
      <span className="sr-only" id="cinema-edit-hint">
        Select a clip to change its duration. Drag to reorder, or use Alt plus left or right arrow.
        Earlier and Later buttons are also available below the timeline.
      </span>
    </div>
  )
}
