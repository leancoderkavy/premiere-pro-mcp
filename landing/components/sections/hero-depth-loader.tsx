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
    let timer = 0

    const sync = () => {
      window.clearTimeout(timer)
      if (!query.matches) {
        setCanRender(false)
        return
      }

      timer = window.setTimeout(() => setCanRender(true), 450)
    }

    sync()
    query.addEventListener("change", sync)
    return () => {
      window.clearTimeout(timer)
      query.removeEventListener("change", sync)
    }
  }, [])

  return canRender ? <HeroDepthScene /> : null
}
