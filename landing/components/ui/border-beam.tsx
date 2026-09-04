import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  className?: string
  style?: CSSProperties
  reverse?: boolean
  initialOffset?: number
  borderWidth?: number
}

export function BorderBeam({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("border-beam", reverse && "border-beam-reverse", className)}
      style={{
        "--border-beam-size": `${size}px`,
        "--border-beam-duration": `${duration}s`,
        "--border-beam-delay": `${-delay - (duration * initialOffset) / 100}s`,
        "--border-beam-from": colorFrom,
        "--border-beam-to": colorTo,
        "--border-beam-width": `${borderWidth}px`,
        ...style,
      } as CSSProperties}
    />
  )
}
