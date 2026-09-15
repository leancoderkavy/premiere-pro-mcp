"use client"

import { Layers3, Pause, Play, RotateCcw, Volume2 } from "lucide-react"
import type { CSSProperties } from "react"
import { cinemaChapters } from "./cinema-content"
import { sequenceFrames, timecode } from "./cinema-interaction"

const clipNames = ["A moment of stillness", "Follow the coastline", "Into the blue"]
const waveform = Array.from({ length: 110 }, (_, index) => {
  const height = 2 + Math.round(Math.abs(Math.sin(index * 1.83) * Math.cos(index * 0.19)) * 18)
  return `M${index * 6 + 2},${24 - height}v${height * 2}`
}).join(" ")

export function CinemaTimeline({
  frame,
  chapter,
  playing,
  exploded,
  onSeek,
  onSelect,
  onPlay,
  onExplode
}: {
  frame: number
  chapter: number
  playing: boolean
  exploded: boolean
  onSeek: (frame: number) => void
  onSelect: (shot: number) => void
  onPlay: () => void
  onExplode: () => void
}) {
  return (
    <div className="cinema-editing-desk" data-exploded={exploded}>
      <div className="cinema-transport">
        <div className="cinema-transport-left">
          <button
            type="button"
            className="cinema-play"
            onClick={onPlay}
            aria-label={
              playing
                ? "Pause sequence"
                : frame === sequenceFrames - 1
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
            onClick={() => onSeek(0)}
            aria-label="Return to first frame"
          >
            <RotateCcw size={15} />
          </button>
          <output className="cinema-timecode" aria-label="Current timecode" aria-live="off">
            {timecode(frame)}
          </output>
          <span className="cinema-duration">/ 00:00:24:00</span>
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
              "--playhead": `${(frame / (sequenceFrames - 1)) * 100}%`,
              "--thumb-offset": `${(frame / (sequenceFrames - 1)) * 16}px`
            } as CSSProperties
          }
        >
          <div className="cinema-deck-header">
            <span>
              <i /> PACIFIC / A SHORT FILM
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
                  {["00:00", "00:04", "00:08", "00:12", "00:16", "00:20", "00:24"].map((mark) => (
                    <span key={mark}>{mark}</span>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={sequenceFrames - 1}
                  step={1}
                  value={frame}
                  onChange={(event) => onSeek(Number(event.currentTarget.value))}
                  aria-label="Scrub editing timeline"
                  aria-valuetext={`${timecode(frame)} — ${clipNames[chapter]}`}
                  className="cinema-scrubber"
                />
              </div>
            </div>
            <div className="cinema-layer cinema-video-layer">
              <span className="cinema-track-label">
                <b>V1</b>PICTURE
              </span>
              <div className="cinema-video-clips">
                {cinemaChapters.map((item, index) => (
                  <button
                    type="button"
                    className="cinema-clip"
                    data-shot={index}
                    key={item.shot}
                    aria-label={`Select clip ${item.shot}: ${clipNames[index]}`}
                    aria-pressed={chapter === index}
                    onClick={() => onSelect(index)}
                  >
                    <span className="cinema-clip-thumb" aria-hidden="true" />
                    <span className="cinema-clip-title">
                      <b>{item.shot}</b>
                      {clipNames[index]}
                      <small>08:00</small>
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
            <span>YOUR NEXT FRAME IS YOURS.</span>
          </div>
        </div>
      </div>
      <p className="cinema-interaction-hint">
        <span>Drag the playhead</span>
        <i /> Select a clip
        <i />
        <span>Move to explore</span>
      </p>
    </div>
  )
}
