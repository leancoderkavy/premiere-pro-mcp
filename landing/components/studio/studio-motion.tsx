"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { Pause, Play } from "lucide-react"
import { useScrollScenes } from "./use-scroll-scenes"

const MotionContext = createContext({ paused: true, toggle: () => {} })

export function StudioMotion({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(true)
  const wrapper = useRef<HTMLDivElement>(null)
  useScrollScenes(wrapper, paused)
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

export function useStudioMotion() {
  return useContext(MotionContext)
}
