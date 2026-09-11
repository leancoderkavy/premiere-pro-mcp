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
import { Pause, Play } from "lucide-react"
import { studioArtwork } from "@/lib/studio-artwork"

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
  const onReady = useCallback((value: boolean) => setReady(value), [])
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
      className="studio-stage studio-art-stage"
      data-enhanced={enhanced && !paused && visible && ready}
      aria-label="Illustrative film frame and editing timeline in three dimensions"
    >
      <div className="studio-film-plane">
        <picture>
          <source
            media="(max-width: 767px)"
            srcSet={studioArtwork.sequence.mobileSrc}
          />
          <Image
            src={studioArtwork.sequence.src}
            alt={studioArtwork.sequence.alt}
            width={1600}
            height={914}
            fetchPriority="high"
            loading="eager"
            sizes="(max-width: 768px) 100vw, 1100px"
          />
        </picture>
      </div>
      {enhanced && !paused && visible && !failed ? (
        <div className="studio-webgl">
          <SceneBoundary onError={onError}>
            <StudioCanvas onReady={onReady} onError={onError} />
          </SceneBoundary>
        </div>
      ) : null}
      <div className="studio-stage-foot">
        <span>Original campaign illustration. Every edit starts with your direction.</span>
      </div>
    </div>
  )
}
