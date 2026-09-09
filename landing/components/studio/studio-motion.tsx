"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
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
import { ArrowUpRight, Check, Pause, Play, ScanLine } from "lucide-react"

const StudioCanvas = dynamic(() => import("./studio-canvas"), { ssr: false })
const MotionContext = createContext({ paused: true, toggle: () => {} })

export function StudioMotion({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(true)
  const wrapper = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection
    const update = () =>
      setPaused(preference.matches || Boolean(connection?.saveData))
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
    <MotionContext.Provider
      value={{ paused, toggle: () => setPaused((value) => !value) }}
    >
      <div
        ref={wrapper}
        className="studio"
        data-motion={paused ? "paused" : "playing"}
      >
        {children}
      </div>
    </MotionContext.Provider>
  )
}

export function MotionToggle() {
  const { paused, toggle } = useContext(MotionContext)
  return (
    <button
      className="studio-motion-toggle"
      type="button"
      onClick={toggle}
      aria-label={
        paused
          ? "Motion off. Enable page animation"
          : "Motion on. Pause page animation"
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
  const onReady = useCallback(() => setReady(true), [])
  const onError = useCallback(() => {
    setReady(false)
    setFailed(true)
  }, [])
  useEffect(() => {
    const viewport = window.matchMedia(
      "(min-width: 1100px) and (pointer: fine)"
    )
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
      else if (stage.current)
        setVisible(stage.current.getBoundingClientRect().bottom > 0)
    }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      observer.disconnect()
      viewport.removeEventListener("change", update)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  return (
    <div
      ref={stage}
      className="studio-stage"
      data-enhanced={enhanced && !paused && visible && ready}
      aria-label="Illustrative film frame and editing timeline in three dimensions"
    >
      <div className="studio-stage-grid" aria-hidden="true" />
      <div className="studio-stage-label">
        <ScanLine size={13} /> A NEW PERSPECTIVE ON YOUR WORKFLOW
      </div>
      <div className="studio-film-plane">
        <picture>
          <source
            media="(max-width: 767px)"
            srcSet="/marketing/cinematic-portal-mobile.webp"
          />
          <Image
            src="/marketing/cinematic-portal.webp"
            alt="Original cinematic artwork: an explorer faces a monumental silver portal in a volcanic landscape"
            width={1280}
            height={736}
            fetchPriority="high"
            loading="eager"
            sizes="(max-width: 768px) 94vw, 700px"
          />
        </picture>
        <div className="studio-film-meta">
          <span>SEQUENCE 01 / THE UNKNOWN</span>
          <span>00:00:24:08</span>
        </div>
      </div>
      <div className="studio-mini-timeline" aria-hidden="true">
        <div className="studio-ruler">
          <span>00:00</span>
          <span>00:08</span>
          <span>00:16</span>
          <span>00:24</span>
          <span>00:32</span>
        </div>
        <div className="studio-track">
          <i>V2</i>
          <span>OPENING</span>
          <span>THE JOURNEY</span>
          <span>DISCOVERY</span>
        </div>
        <div className="studio-track">
          <i>V1</i>
          <span>ATMOSPHERE</span>
          <span>THE UNKNOWN</span>
        </div>
        <div className="studio-track studio-audio">
          <i>A1</i>
          <span>AMBIENCE / ORIGINAL SCORE</span>
        </div>
        <div className="studio-playhead" />
      </div>
      {enhanced && !paused && visible && !failed ? (
        <div className="studio-webgl">
          <SceneBoundary onError={onError}>
            <StudioCanvas onReady={onReady} onError={onError} />
          </SceneBoundary>
        </div>
      ) : null}
      <div className="studio-command">
        <span className="studio-command-icon">
          <ArrowUpRight size={19} />
        </span>
        <div>
          <span className="studio-label">YOUR DIRECTION. STRUCTURED.</span>
          <p>
            “Prepare the assembly.
            <br />
            Let me review the changes.”
          </p>
        </div>
        <span className="studio-command-status">
          <Check size={12} /> PREVIEW FIRST
        </span>
      </div>
      <div className="studio-stage-foot">
        <span>
          <i /> WORKFLOW ILLUSTRATION
        </span>
        <span>SCROLL TO EXPLORE ↓</span>
      </div>
    </div>
  )
}
