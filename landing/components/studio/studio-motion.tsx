"use client"

import dynamic from "next/dynamic"
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react"
import { Pause, Play } from "lucide-react"
import { cinemaChapters } from "./cinema-content"
import { CinemaFallback } from "./cinema-fallback"

const StudioCanvas = dynamic(() => import("./studio-canvas"), { ssr: false })
const MotionContext = createContext({ paused: true, toggle: () => {} })

export function StudioMotion({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(true)
  const wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    const update = () => setPaused(preference.matches || Boolean(connection?.saveData))
    update()
    preference.addEventListener("change", update)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("studio-revealed")
            observer.unobserve(entry.target)
          }
      },
      { threshold: 0.08 }
    )
    wrapper.current
      ?.querySelectorAll("[data-studio-reveal]")
      .forEach((node) => observer.observe(node))
    return () => {
      preference.removeEventListener("change", update)
      observer.disconnect()
    }
  }, [])
  return (
    <MotionContext.Provider value={{ paused, toggle: () => setPaused((value) => !value) }}>
      <div ref={wrapper} className="studio" data-motion={paused ? "paused" : "playing"}>
        {children}
      </div>
    </MotionContext.Provider>
  )
}

export function MotionToggle({ location = "page" }: { location?: "page" | "scene" }) {
  const { paused, toggle } = useContext(MotionContext)
  return (
    <button
      className="studio-motion-toggle"
      type="button"
      onClick={toggle}
      aria-label={
        paused
          ? `Motion off. Enable ${location} animation`
          : `Motion on. Pause ${location} animation`
      }
      aria-pressed={!paused}
    >
      {paused ? <Play size={13} /> : <Pause size={13} />}
      <span>Motion {paused ? "off" : "on"}</span>
    </button>
  )
}

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
  const { paused } = useContext(MotionContext)
  const stage = useRef<HTMLDivElement>(null)
  const [enhanced, setEnhanced] = useState(false)
  const [visible, setVisible] = useState(true)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [chapter, setChapter] = useState(1)
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
      className="studio-stage cinema-stage"
      data-enhanced={enhanced && !paused && visible && ready}
      aria-label="The cutting room — an interactive cinematic illustration"
    >
      <div className="cinema-stage-heading">
        <span>
          <i /> THE CUTTING ROOM
        </span>
        <span>AN IDEA. A SEQUENCE. A FILM.</span>
      </div>
      <div className="cinema-viewport">
        <CinemaFallback chapter={chapter} />
        {enhanced && !paused && visible && !failed ? (
          <div className="studio-webgl">
            <SceneBoundary onError={onError}>
              <StudioCanvas onReady={onReady} onError={onError} chapter={chapter} />
            </SceneBoundary>
          </div>
        ) : null}
        <div className="cinema-gate cinema-gate-left" aria-hidden="true" />
        <div className="cinema-gate cinema-gate-right" aria-hidden="true" />
        <div className="cinema-frame-label" aria-hidden="true">
          <span>SELECT {cinemaChapters[chapter].shot}</span>
          <span>2.39:1 / 24 FPS</span>
        </div>
      </div>
      <div className="cinema-caption" aria-live="polite" aria-atomic="true">
        <p>{cinemaChapters[chapter].title}</p>
        <span>{cinemaChapters[chapter].detail}</span>
      </div>
      <div className="cinema-chapters" role="group" aria-label="Choose a film chapter">
        {cinemaChapters.map((item, index) => (
          <button
            key={item.shot}
            type="button"
            aria-pressed={chapter === index}
            onClick={() => setChapter(index)}
          >
            <span>{item.shot}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div className="cinema-stage-footer">
        <span>Original film artwork · An illustrative editing sequence</span>
        <div className="cinema-stage-motion">
          <MotionToggle location="scene" />
        </div>
      </div>
    </section>
  )
}
