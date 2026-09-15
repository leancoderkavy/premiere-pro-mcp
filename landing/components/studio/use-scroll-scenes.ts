"use client"

import { useEffect, type RefObject } from "react"

/** One event-driven frame for all visible scenes; no idle animation loop. */
export function useScrollScenes(root: RefObject<HTMLDivElement | null>, paused: boolean) {
  useEffect(() => {
    const element = root.current
    if (!element || paused) return
    const scenes = Array.from(element.querySelectorAll<HTMLElement>("[data-scroll-scene]"))
    const visible = new Set<HTMLElement>()
    let frame = 0
    const paint = () => {
      frame = 0
      const height = window.innerHeight
      const mobile = window.innerWidth < 768
      // Batch layout reads before style writes.
      const measurements = Array.from(visible, node => ({ node, rect: node.getBoundingClientRect() }))
      for (const { node, rect } of measurements) {
        const progress = Math.max(0, Math.min(1, (height - rect.top) / (height + rect.height)))
        const offset = (0.5 - progress) * (mobile ? 24 : 100)
        node.style.setProperty("--scene-y", `${offset.toFixed(2)}px`)
        node.style.setProperty("--scene-angle", `${((0.5 - progress) * (mobile ? 2 : 12)).toFixed(2)}deg`)
        node.style.setProperty("--scene-scale", `${(0.94 + Math.sin(progress * Math.PI) * 0.06).toFixed(4)}`)
        node.style.setProperty("--scene-progress", progress.toFixed(4))
      }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement
        if (entry.isIntersecting) visible.add(node)
        else visible.delete(node)
      }
      schedule()
    }, { rootMargin: "200px" })
    scenes.forEach(node => observer.observe(node))
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      scenes.forEach(node => {
        for (const property of ["--scene-y", "--scene-angle", "--scene-scale", "--scene-progress"])
          node.style.removeProperty(property)
      })
    }
  }, [root, paused])
}
