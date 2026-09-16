"use client"

import {
  ArrowLeft,
  ArrowRight,
  Layers3,
  Magnet,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
  Volume2
} from "lucide-react"
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { cinemaChapters } from "./cinema-content"
import { timecode } from "./cinema-interaction"
import { clipNames, sourceFrames, type CinemaClip } from "./cinema-sequence"
import { useClipDrag } from "./cinema-drag"
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
  const root = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [snapping, setSnapping] = useState(true)
  const { frame, duration, sequence, busy, selectedShot } = editor
  const span = Math.max(720, Math.ceil((duration + 96) / 96) * 96)
  const drag = useClipDrag(editor, root, scroll, canvas, span, snapping)
  const selected =
    drag.preview?.clip.shot === selectedShot
      ? drag.preview.clip
      : sequence.clips.find((clip) => clip.shot === selectedShot)!
  const index = sequence.clips.findIndex((clip) => clip.shot === selectedShot)
  const disabled = busy || Boolean(drag.preview)
  const marks = Array.from({ length: Math.ceil(span / 96) + 1 }, (_, mark) => mark * 96).filter(
    (mark) => mark <= span
  )
  const changeZoom = (value: number) => {
    const next = Math.max(1, Math.min(4, value))
    if (disabled) return
    setZoom(next)
    requestAnimationFrame(() => {
      if (scroll.current && canvas.current)
        scroll.current.scrollLeft =
          (frame / span) * canvas.current.clientWidth - scroll.current.clientWidth / 2
    })
  }
  const shortcut = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      drag.cancel()
      return
    }
    if (disabled || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return
    event.preventDefault()
    if (event.shiftKey) editor.redo()
    else editor.undo()
  }
  const clipKey = (event: KeyboardEvent<HTMLButtonElement>, clip: CinemaClip) => {
    if (disabled) return
    if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault()
      editor.reorder(
        clip.shot,
        sequence.clips.findIndex((item) => item.shot === clip.shot) +
          (event.key === "ArrowLeft" ? -1 : 1)
      )
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault()
      const step = event.shiftKey ? 24 : 1
      editor.editClip({
        ...clip,
        start:
          clip.start + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
        track: event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? 0 : clip.track
      })
    } else if (event.code === "Space") {
      event.preventDefault()
      editor.toggle()
    }
  }
  const trimKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    clip: CinemaClip,
    edge: "in" | "out"
  ) => {
    if (disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return
    event.preventDefault()
    const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 24 : 1)
    editor.editClip(
      edge === "in"
        ? {
            ...clip,
            start: clip.start + delta,
            sourceIn: clip.sourceIn + delta,
            duration: clip.duration - delta
          }
        : { ...clip, duration: clip.duration + delta }
    )
  }
  return (
    <div
      ref={root}
      className="cinema-editing-desk cinema-nle"
      data-exploded={exploded}
      data-dragging={Boolean(drag.preview)}
      onPointerMove={drag.move}
      onPointerUp={drag.finish}
      onPointerCancel={drag.cancel}
      onLostPointerCapture={drag.cancel}
      onKeyDown={shortcut}
    >
      <div className="cinema-deck-space">
        <div className="cinema-deck">
          <div className="cinema-deck-header">
            <span>
              <i /> PACIFIC / YOUR EDIT
            </span>
            <button
              type="button"
              className="cinema-layers-toggle"
              onClick={onExplode}
              aria-pressed={exploded}
              disabled={disabled}
            >
              <Layers3 size={14} />
              <span>{exploded ? "Bring layers together" : "Separate layers"}</span>
            </button>
            <span>
              SEQUENCE 01 <b>24 FPS</b>
            </span>
          </div>
          <div className="nle-toolbar" aria-label="Timeline editing tools">
            <div className="nle-edit-tools">
              <button
                type="button"
                onClick={editor.undo}
                disabled={disabled || !editor.canUndo}
                aria-label="Undo last edit"
                title="Undo · Ctrl/Cmd Z"
              >
                <Undo2 size={15} />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={editor.redo}
                disabled={disabled || !editor.canRedo}
                aria-label="Redo last edit"
                title="Redo · Ctrl/Cmd Shift Z"
              >
                <Redo2 size={15} />
                <span>Redo</span>
              </button>
              <button
                type="button"
                className="nle-snap-toggle"
                aria-pressed={snapping}
                disabled={disabled}
                onClick={() => setSnapping((value) => !value)}
                title="Snap to clip edges and the playhead"
              >
                <Magnet size={15} />
                <span>Snap {snapping ? "on" : "off"}</span>
              </button>
            </div>
            <div className="nle-zoom-controls">
              <button
                type="button"
                onClick={() => changeZoom(zoom - 0.5)}
                disabled={disabled || zoom === 1}
                aria-label="Zoom out timeline"
              >
                <Minus size={14} />
              </button>
              <label>
                <span className="sr-only">Timeline zoom</span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.5}
                  value={zoom}
                  disabled={disabled}
                  onChange={(event) => changeZoom(Number(event.currentTarget.value))}
                  aria-label="Timeline zoom"
                  aria-valuetext={`${zoom} times`}
                />
              </label>
              <button
                type="button"
                onClick={() => changeZoom(zoom + 0.5)}
                disabled={disabled || zoom === 4}
                aria-label="Zoom in timeline"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => changeZoom(1)}
                disabled={disabled}
                className="nle-fit"
              >
                Fit
              </button>
            </div>
          </div>
          <div className="nle-workspace">
            <div className="nle-track-labels" aria-hidden="true">
              <div className="nle-ruler-label">TIME</div>
              <div className="nle-video-label">
                <b>V2</b>
                <span>OVERLAY</span>
              </div>
              <div className="nle-video-label">
                <b>V1</b>
                <span>PICTURE</span>
              </div>
              <div className="nle-fx-label">
                <b>FX</b>
              </div>
              <div className="nle-audio-label">
                <b>A1</b>
                <Volume2 size={12} />
              </div>
            </div>
            <div
              ref={scroll}
              className="nle-scroll"
              tabIndex={0}
              aria-label="Scrollable editing timeline"
            >
              <div
                ref={canvas}
                className="nle-canvas"
                style={
                  {
                    width: `${zoom * 100}%`,
                    "--sequence-width": `${(duration / span) * 100}%`
                  } as CSSProperties
                }
              >
                <div className="nle-ruler">
                  <div className="nle-time-marks" aria-hidden="true">
                    {marks.map((mark) => (
                      <span key={mark} style={{ left: `${(mark / span) * 100}%` }}>
                        {timecode(mark).slice(3, 8)}
                      </span>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration - 1}
                    step={1}
                    value={frame}
                    style={{ width: `${(duration / span) * 100}%` }}
                    onChange={(event) => editor.seek(Number(event.currentTarget.value))}
                    aria-label="Scrub editing timeline"
                    aria-valuetext={`${timecode(frame)} — ${editor.activeShot === null ? "Gap" : clipNames[editor.activeShot]}`}
                    className="cinema-scrubber"
                  />
                </div>
                {[1, 0].map((track) => (
                  <div
                    key={track}
                    className="nle-video-row"
                    data-edit-track={track}
                    aria-label={`Video track ${track + 1}`}
                    role="group"
                  >
                    <span className="nle-empty-track" aria-hidden="true">
                      {track === 1 ? "↑ Drag a clip onto V2" : "Drag clips along the track"}
                    </span>
                    {sequence.clips
                      .filter((clip) => clip.track === track)
                      .map((clip) => (
                        <div
                          className="nle-clip"
                          key={clip.shot}
                          data-selected={clip.shot === selectedShot}
                          data-source-dragging={drag.preview?.clip.shot === clip.shot}
                          data-start={clip.start}
                          data-duration={clip.duration}
                          style={{
                            left: `${(clip.start / span) * 100}%`,
                            width: `${(clip.duration / span) * 100}%`
                          }}
                        >
                          <button
                            type="button"
                            className="cinema-clip nle-clip-body"
                            data-shot={clip.shot}
                            aria-label={`Select clip ${cinemaChapters[clip.shot].shot}: ${clipNames[clip.shot]}`}
                            aria-describedby="cinema-edit-hint"
                            aria-pressed={clip.shot === selectedShot}
                            onPointerDown={(event) => drag.begin(event, clip, "move")}
                            onClick={() => drag.click(clip.shot)}
                            onKeyDown={(event) => clipKey(event, clip)}
                          >
                            <span className="cinema-clip-thumb" aria-hidden="true" />
                            <span className="cinema-clip-title">
                              <b>{cinemaChapters[clip.shot].shot}</b>
                              {clipNames[clip.shot]}
                            </span>
                            <small className="nle-clip-duration">
                              {timecode(clip.duration).slice(6)}
                            </small>
                          </button>
                          <button
                            type="button"
                            className="nle-trim-handle nle-trim-in"
                            aria-label={`Trim start of clip ${cinemaChapters[clip.shot].shot}`}
                            title="Drag to trim the start · Arrow keys for one frame"
                            disabled={busy}
                            onPointerDown={(event) => drag.begin(event, clip, "in")}
                            onKeyDown={(event) => trimKey(event, clip, "in")}
                          >
                            <span aria-hidden="true">Ⅱ</span>
                          </button>
                          <button
                            type="button"
                            className="nle-trim-handle nle-trim-out"
                            aria-label={`Trim end of clip ${cinemaChapters[clip.shot].shot}`}
                            title="Drag to trim the end · Arrow keys for one frame"
                            disabled={busy}
                            onPointerDown={(event) => drag.begin(event, clip, "out")}
                            onKeyDown={(event) => trimKey(event, clip, "out")}
                          >
                            <span aria-hidden="true">Ⅱ</span>
                          </button>
                        </div>
                      ))}
                    {drag.preview?.clip.track === track ? (
                      <div
                        className="nle-drag-preview"
                        data-valid={drag.preview.valid}
                        style={{
                          left: `${(drag.preview.clip.start / span) * 100}%`,
                          width: `${(drag.preview.clip.duration / span) * 100}%`
                        }}
                        aria-hidden="true"
                      >
                        <span>{clipNames[drag.preview.clip.shot]}</span>
                        <b>
                          {timecode(drag.preview.clip.start)} →{" "}
                          {timecode(drag.preview.clip.start + drag.preview.clip.duration)}
                        </b>
                        <small>
                          {drag.preview.valid
                            ? drag.preview.kind === "move"
                              ? `DROP ON V${track + 1}`
                              : "TRIM EDGE"
                            : "SPACE OCCUPIED"}
                        </small>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="nle-fx-row">
                  <div style={{ width: `${(duration / span) * 100}%` }}>
                    ◈ COASTAL LIGHT <span>COLOR GRADE</span>
                  </div>
                </div>
                <div className="nle-audio-row">
                  <div style={{ width: `${(duration / span) * 100}%` }}>
                    <span>OCEAN / AMBIENCE</span>
                    <svg viewBox="0 0 660 48" preserveAspectRatio="none" aria-hidden="true">
                      <path d={waveform} fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </div>
                </div>
                <div className="nle-marker-track" role="group" aria-label="Review markers">
                  {sequence.markers.map((marker, markerIndex) => (
                    <button
                      type="button"
                      key={`${marker.frame}-${markerIndex}`}
                      className="cinema-review-marker"
                      style={{ left: `${(marker.frame / span) * 100}%` }}
                      aria-label={`${marker.name} at ${timecode(marker.frame)}`}
                      onClick={() => editor.seek(marker.frame)}
                    >
                      <span aria-hidden="true">◆</span>
                    </button>
                  ))}
                </div>
                <div
                  className="nle-playhead"
                  style={{ left: `${(frame / span) * 100}%` }}
                  aria-hidden="true"
                >
                  <i />
                  <span>{timecode(frame).slice(6)}</span>
                </div>
                {drag.preview?.snap !== null && drag.preview?.snap !== undefined ? (
                  <div
                    className="nle-snap-line"
                    style={{ left: `${(drag.preview.snap / span) * 100}%` }}
                    aria-hidden="true"
                  >
                    <span>SNAP</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="cinema-deck-bottom">
            <span>
              {sequence.clips.length} SHOTS <i /> {sequence.markers.length} MARKERS
            </span>
            <span>
              {drag.preview
                ? drag.preview.valid
                  ? "RELEASE TO APPLY · ESC TO CANCEL"
                  : "CHOOSE AN EMPTY SPACE"
                : "DRAG TO MOVE · EDGES TO TRIM"}
            </span>
          </div>
        </div>
      </div>
      <div className="cinema-clip-inspector" aria-label="Edit the selected clip">
        <div className="cinema-selected-name">
          <span>
            SELECTED / V{selected.track + 1} · {timecode(selected.start)}
          </span>
          <strong>{clipNames[selectedShot]}</strong>
        </div>
        <label className="nle-track-select">
          <span>Track</span>
          <select
            aria-label="Selected clip video track"
            value={selected.track}
            disabled={disabled}
            onChange={(event) =>
              editor.editClip({ ...selected, track: Number(event.currentTarget.value) })
            }
          >
            <option value={0}>V1 · Picture</option>
            <option value={1}>V2 · Overlay</option>
          </select>
        </label>
        <label className="cinema-trim-control">
          <span>
            Ripple duration <output aria-live="off">{(selected.duration / 24).toFixed(2)}s</output>
          </span>
          <input
            type="range"
            min={24}
            max={sourceFrames - selected.sourceIn}
            step={1}
            value={selected.duration}
            disabled={disabled}
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
            onChange={(event) => editor.resize(selectedShot, Number(event.currentTarget.value))}
          />
        </label>
        <div className="cinema-edit-actions">
          <button
            type="button"
            disabled={disabled || index === 0}
            onClick={() => editor.reorder(selectedShot, index - 1)}
            aria-label="Move selected clip earlier"
          >
            <ArrowLeft size={15} />
            <span>Earlier</span>
          </button>
          <button
            type="button"
            disabled={disabled || index === sequence.clips.length - 1}
            onClick={() => editor.reorder(selectedShot, index + 1)}
            aria-label="Move selected clip later"
          >
            <ArrowRight size={15} />
            <span>Later</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={editor.reset}
            aria-label="Reset demo sequence"
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </div>
      <p className="cinema-interaction-hint">
        <span>Drag clips freely</span>
        <i /> Pull either edge to trim
        <i />
        <span>Zoom in for precision</span>
      </p>
      <span className="sr-only" id="cinema-edit-hint">
        Drag a clip in time or to another video track. Pull its start or end handle to trim. Arrow
        keys move one frame, Shift plus arrows move one second, and up or down changes track. Escape
        cancels a drag. Ctrl or Command Z undoes, and Shift Z redoes.
      </span>
    </div>
  )
}
