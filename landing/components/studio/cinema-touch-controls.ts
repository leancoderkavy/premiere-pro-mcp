import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react"

/** Keep monitor and timeline controls responsive immediately after a touch drag. */
export function activateTouchControl(event: ReactPointerEvent<HTMLDivElement>) {
  if (event.pointerType !== "touch" || !event.isPrimary) return
  const target = event.target as Element
  const button = target.closest("button")
  if (!button || button.disabled || target.closest(".nle-clip")) return
  const bounds = button.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    return
  // Chromium may swallow the compatibility click after a drag. Activate once
  // on release and suppress the subsequent touch click; mouse/keyboard stay native.
  event.preventDefault()
  button.click()
}

export function suppressNativeTouchClick(event: MouseEvent<HTMLDivElement>) {
  if ((event.nativeEvent as PointerEvent).pointerType !== "touch") return
  const target = event.target as Element
  if (target.closest("button") && !target.closest(".nle-clip")) {
    event.preventDefault()
    event.stopPropagation()
  }
}
