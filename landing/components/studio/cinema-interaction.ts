"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

export const sequenceFrames = 24 * 24
export const shotFrames = 8 * 24
export type ParallaxPosition = { x: number; y: number; scroll: number }

export function timecode(frame: number) {
  return `00:00:${String(Math.floor(frame / 24)).padStart(2, "0")}:${String(frame % 24).padStart(2, "0")}`
}

export function useSequenceTransport(visible: boolean) {
  const [frame, setFrame] = useState(240)
  const [playing, setPlaying] = useState(false)
  const current = useRef(frame)
  useEffect(() => {
    current.current = frame
  }, [frame])
  useEffect(() => {
    if (!playing || !visible) return
    const start = performance.now()
    const first = current.current
    let handle = 0
    const tick = (now: number) => {
      const next = Math.min(sequenceFrames - 1, first + Math.floor(((now - start) * 24) / 1000))
      setFrame(next)
      if (next === sequenceFrames - 1) setPlaying(false)
      else handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, visible])
  const seek = useCallback((next: number) => {
    setPlaying(false)
    setFrame(Math.max(0, Math.min(sequenceFrames - 1, Math.round(next))))
  }, [])
  const selectShot = useCallback((shot: number) => seek(shot * shotFrames + 48), [seek])
  const toggle = () => {
    if (frame >= sequenceFrames - 1) setFrame(0)
    setPlaying((value) => !value)
  }
  return {
    frame,
    playing,
    seek,
    selectShot,
    toggle,
    chapter: Math.min(2, Math.floor(frame / shotFrames))
  }
}

/** Pointer and scroll movement update CSS and WebGL through one ref, without React renders. */
export function useCinemaParallax(stage: RefObject<HTMLElement | null>, disabled: boolean) {
  const position = useRef<ParallaxPosition>({ x: 0, y: 0, scroll: 0 })
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const target = { x: 0, y: 0, scroll: 0 }
    let handle = 0
    const update = () => {
      const current = position.current
      current.x += (target.x - current.x) * 0.14
      current.y += (target.y - current.y) * 0.14
      current.scroll += (target.scroll - current.scroll) * 0.14
      element.style.setProperty("--orbit-x", `${current.x * 6}deg`)
      element.style.setProperty("--orbit-y", `${-current.y * 4}deg`)
      element.style.setProperty("--drift-x", `${current.x * 15}px`)
      element.style.setProperty("--drift-y", `${current.y * -10}px`)
      element.style.setProperty("--scroll-depth", `${current.scroll * 24}px`)
      if (
        Math.abs(target.x - current.x) +
          Math.abs(target.y - current.y) +
          Math.abs(target.scroll - current.scroll) >
        0.002
      )
        handle = requestAnimationFrame(update)
      else handle = 0
    }
    const schedule = () => {
      if (!handle) handle = requestAnimationFrame(update)
    }
    const move = (event: PointerEvent) => {
      if (disabled || event.pointerType !== "mouse" || event.buttons > 0) return
      const bounds = element.getBoundingClientRect()
      target.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2))
      target.y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2))
      schedule()
    }
    const leave = () => {
      target.x = 0
      target.y = 0
      schedule()
    }
    const scroll = () => {
      if (disabled) return
      const bounds = element.getBoundingClientRect()
      target.scroll = Math.max(
        -1,
        Math.min(
          1,
          (window.innerHeight * 0.5 - bounds.top - bounds.height * 0.5) / window.innerHeight
        )
      )
      schedule()
    }
    if (disabled) {
      position.current = { x: 0, y: 0, scroll: 0 }
      update()
    } else scroll()
    element.addEventListener("pointermove", move)
    element.addEventListener("pointerleave", leave)
    window.addEventListener("scroll", scroll, { passive: true })
    return () => {
      cancelAnimationFrame(handle)
      element.removeEventListener("pointermove", move)
      element.removeEventListener("pointerleave", leave)
      window.removeEventListener("scroll", scroll)
    }
  }, [stage, disabled])
  return position
}
