"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

const HeroDepthScene = dynamic(
  () => import("@/components/sections/hero-depth-scene").then((module) => module.HeroDepthScene),
  { ssr: false },
)

export function HeroDepthLoader() {
  const [canRender, setCanRender] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px) and (prefers-reduced-motion: no-preference)")
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }
    let timer = 0
    let idleHandle = 0

    const clearScheduledRender = () => {
      window.clearTimeout(timer)
      if (browserWindow.cancelIdleCallback && idleHandle) browserWindow.cancelIdleCallback(idleHandle)
      idleHandle = 0
    }

    const sync = () => {
      clearScheduledRender()
      if (!query.matches) {
        setCanRender(false)
        return
      }

      const renderWhenIdle = () => setCanRender(true)
      if (browserWindow.requestIdleCallback) {
        idleHandle = browserWindow.requestIdleCallback(renderWhenIdle, { timeout: 2_000 })
      } else {
        timer = window.setTimeout(renderWhenIdle, 1_500)
      }
    }

    sync()
    query.addEventListener("change", sync)
    return () => {
      clearScheduledRender()
      query.removeEventListener("change", sync)
    }
  }, [])

  return canRender ? <HeroDepthScene /> : null
}
