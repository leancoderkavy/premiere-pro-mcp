"use client"

import dynamic from "next/dynamic"
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cinemaChapters } from "./cinema-content"
import { CinemaFallback } from "./cinema-fallback"
import { CinemaTimeline } from "./cinema-timeline"
import { useCinemaParallax, useSequenceTransport } from "./cinema-interaction"
import { MotionToggle, useStudioMotion } from "./studio-motion"

const StudioCanvas = dynamic(() => import("./studio-canvas"), { ssr: false })

class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function StudioStage() {
  const { paused } = useStudioMotion()
  const stage = useRef<HTMLElement>(null)
  const [enhanced, setEnhanced] = useState(false)
  const [visible, setVisible] = useState(true)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [exploded, setExploded] = useState(false)
  const transport = useSequenceTransport(visible)
  const parallax = useCinemaParallax(stage, paused || !enhanced || !visible)
  const onReady = useCallback((value: boolean) => setReady(value), [])
  const onError = useCallback(() => {
    setReady(false)
    setFailed(true)
  }, [])
  useEffect(() => {
    const viewport = window.matchMedia("(min-width: 900px) and (pointer: fine)")
    const update = () => setEnhanced(viewport.matches)
    update()
    viewport.addEventListener("change", update)
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && !document.hidden),
      { rootMargin: "80px" }
    )
    if (stage.current) observer.observe(stage.current)
    const visibility = () => {
      if (document.hidden) setVisible(false)
      else if (stage.current) {
        const bounds = stage.current.getBoundingClientRect()
        setVisible(bounds.bottom > -80 && bounds.top < window.innerHeight + 80)
      }
    }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      observer.disconnect()
      viewport.removeEventListener("change", update)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  return (
    <section
      ref={stage}
      className="studio-stage cinema-stage cinema-interactive"
      data-enhanced={enhanced && !paused && visible && ready}
      data-exploded={exploded}
      aria-label="The cutting room — an interactive cinematic illustration"
    >
      <div className="cinema-stage-heading">
        <span>
          <i /> THE CUTTING ROOM
        </span>
        <span>YOUR STORY. IN EVERY DIMENSION.</span>
      </div>
      <div className="cinema-monitor-space">
        <div className="cinema-viewport">
          <CinemaFallback chapter={transport.chapter} />
          {enhanced && !paused && visible && !failed ? (
            <div className="studio-webgl">
              <SceneBoundary onError={onError}>
                <StudioCanvas
                  onReady={onReady}
                  onError={onError}
                  chapter={transport.chapter}
                  parallax={parallax}
                  exploded={exploded}
                  onSelect={transport.selectShot}
                />
              </SceneBoundary>
            </div>
          ) : null}
          <div className="cinema-gate cinema-gate-left" aria-hidden="true" />
          <div className="cinema-gate cinema-gate-right" aria-hidden="true" />
          <div className="cinema-frame-label" aria-hidden="true">
            <span>PROGRAM / SELECT {cinemaChapters[transport.chapter].shot}</span>
            <span>2.39:1 / 24 FPS</span>
          </div>
        </div>
        <div
          className="cinema-monitor-caption cinema-caption"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{cinemaChapters[transport.chapter].shot}</span>
          <p>{cinemaChapters[transport.chapter].title}</p>
          <i />
          <span>SELECTED SHOT</span>
        </div>
      </div>
      <CinemaTimeline
        frame={transport.frame}
        chapter={transport.chapter}
        playing={transport.playing}
        exploded={exploded}
        onSeek={transport.seek}
        onSelect={transport.selectShot}
        onPlay={transport.toggle}
        onExplode={() => setExploded((value) => !value)}
      />
      <div className="cinema-chapters" role="group" aria-label="Choose a film chapter">
        {cinemaChapters.map((item, index) => (
          <button
            key={item.shot}
            type="button"
            aria-pressed={transport.chapter === index}
            onClick={() => transport.selectShot(index)}
          >
            <span>{item.shot}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="cinema-stage-footer">
        <span>An interactive film study. Imagine what you’ll make in Premiere.</span>
        <div className="cinema-stage-motion">
          <MotionToggle location="scene" />
        </div>
      </div>
    </section>
  )
}
