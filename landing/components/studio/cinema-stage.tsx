"use client"

import dynamic from "next/dynamic"
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { cinemaChapters } from "./cinema-content"
import { CinemaFallback } from "./cinema-fallback"
import { CinemaTimeline } from "./cinema-timeline"
import { useCinemaParallax } from "./cinema-interaction"
import { useCinemaEditor } from "./cinema-editor"
import { CinemaWorkflow } from "./cinema-workflow"
import { CinemaMonitor } from "./cinema-monitor"
import { activateTouchControl, suppressNativeTouchClick } from "./cinema-touch-controls"
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
  const [cinematic, setCinematic] = useState(false)
  const transport = useCinemaEditor(visible)
  const parallax = useCinemaParallax(stage, paused || !enhanced || !visible || !cinematic)
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
      data-enhanced={cinematic && enhanced && !paused && visible && ready}
      data-exploded={exploded}
      aria-label="The cutting room — an interactive cinematic illustration"
    >
      <div className="cinema-stage-heading">
        <span>
          <i /> THE CUTTING ROOM
        </span>
        <span>INTERACTIVE EDITING DEMO</span>
      </div>
      <CinemaWorkflow editor={transport} />
      <div
        className="cinema-editor-workspace"
        id="editing-timeline"
        onPointerUp={activateTouchControl}
        onClickCapture={suppressNativeTouchClick}
      >
        <CinemaMonitor
          editor={transport}
          cinematic={cinematic}
          onCinematic={() => setCinematic((value) => !value)}
        >
          <div className="cinema-viewport" data-gap={transport.activeShot === null}>
            <CinemaFallback chapter={transport.chapter} />
            {cinematic && enhanced && !paused && visible && !failed ? (
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
              <span>
                PROGRAM /{" "}
                {transport.activeShot === null
                  ? "GAP"
                  : `SELECT ${cinemaChapters[transport.chapter].shot}`}
              </span>
              <span>2.39:1 / 24 FPS</span>
            </div>
          </div>
        </CinemaMonitor>
        <CinemaTimeline
          editor={transport}
          exploded={exploded}
          onExplode={() => setExploded((value) => !value)}
        />
      </div>
      <div className="cinema-chapters" role="group" aria-label="Choose a film chapter">
        {cinemaChapters.map((item, index) => (
          <button
            key={item.shot}
            type="button"
            aria-pressed={transport.activeShot === index}
            onClick={() => transport.selectShot(index)}
          >
            <span>{item.shot}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="cinema-stage-footer">
        <span>A browser demo of the MCP workflow. Your real edit happens in Premiere.</span>
        <div className="cinema-stage-motion">
          <MotionToggle location="scene" />
        </div>
      </div>
    </section>
  )
}
