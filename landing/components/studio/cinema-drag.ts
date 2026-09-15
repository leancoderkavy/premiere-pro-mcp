"use client"

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react"
import {
  canPlaceClip,
  maxTimelineFrames,
  snapFrame,
  sourceFrames,
  type CinemaClip
} from "./cinema-sequence"
import type { CinemaEditor } from "./cinema-editor"

type EditKind = "move" | "in" | "out"
type Preview = { clip: CinemaClip; valid: boolean; snap: number | null; kind: EditKind }
type Drag = {
  clip: CinemaClip
  kind: EditKind
  pointerId: number
  x: number
  y: number
  currentX: number
  currentY: number
  scroll: number
  scale: number
  anchors: number[]
  moved: boolean
  clips: CinemaClip[]
  snapping: boolean
}

export function useClipDrag(
  editor: CinemaEditor,
  root: RefObject<HTMLDivElement | null>,
  scroll: RefObject<HTMLDivElement | null>,
  canvas: RefObject<HTMLDivElement | null>,
  span: number,
  snapping: boolean
) {
  const active = useRef<Drag | null>(null)
  const latest = useRef<Preview | null>(null)
  const animation = useRef(0)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  useEffect(() => () => cancelAnimationFrame(animation.current), [])

  const update = () => {
    const drag = active.current
    if (!drag || !scroll.current || !canvas.current) return
    if (!drag.moved && Math.hypot(drag.currentX - drag.x, drag.currentY - drag.y) < 5) return
    drag.moved = true
    const delta = Math.round(
      (drag.currentX - drag.x + scroll.current.scrollLeft - drag.scroll) / drag.scale
    )
    const clip = { ...drag.clip }
    let snap: number | null = null
    const tolerance = drag.snapping ? 8 / drag.scale : 0
    if (drag.kind === "move") {
      const target = document
        .elementFromPoint(drag.currentX, drag.currentY)
        ?.closest<HTMLElement>("[data-edit-track]")
      if (target) clip.track = Number(target.dataset.editTrack)
      clip.start = Math.max(0, Math.min(maxTimelineFrames - clip.duration, clip.start + delta))
      if (drag.snapping) {
        const left = snapFrame(clip.start, drag.anchors, tolerance)
        const right = snapFrame(clip.start + clip.duration, drag.anchors, tolerance)
        if (
          left !== null &&
          (right === null ||
            Math.abs(left - clip.start) <= Math.abs(right - clip.start - clip.duration))
        ) {
          clip.start = left
          snap = left
        } else if (right !== null) {
          clip.start = right - clip.duration
          snap = right
        }
      }
    } else if (drag.kind === "in") {
      let start = clip.start + delta
      if (drag.snapping) {
        snap = snapFrame(start, drag.anchors, tolerance)
        if (snap !== null) start = snap
      }
      const offset = Math.max(
        -Math.min(clip.sourceIn, clip.start),
        Math.min(clip.duration - 24, start - clip.start)
      )
      clip.start += offset
      clip.sourceIn += offset
      clip.duration -= offset
      if (snap !== clip.start) snap = null
    } else {
      let end = clip.start + clip.duration + delta
      if (drag.snapping) {
        snap = snapFrame(end, drag.anchors, tolerance)
        if (snap !== null) end = snap
      }
      clip.duration = Math.max(
        24,
        Math.min(sourceFrames - clip.sourceIn, maxTimelineFrames - clip.start, end - clip.start)
      )
      if (snap !== clip.start + clip.duration) snap = null
    }
    const next = { clip, valid: canPlaceClip(drag.clips, clip), snap, kind: drag.kind }
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) {
      latest.current = next
      setPreview(next)
    }
  }
  const stop = () => {
    const previous = active.current
    active.current = null
    cancelAnimationFrame(animation.current)
    if (previous && root.current?.hasPointerCapture(previous.pointerId))
      root.current.releasePointerCapture(previous.pointerId)
    latest.current = null
    setPreview(null)
  }
  const begin = (event: PointerEvent<HTMLButtonElement>, clip: CinemaClip, kind: EditKind) => {
    if (
      editor.busy ||
      !event.isPrimary ||
      event.button !== 0 ||
      !canvas.current ||
      !scroll.current ||
      !root.current
    )
      return
    // CSS touch-action owns touch gestures; suppress native mouse selection only.
    if (event.pointerType === "mouse") event.preventDefault()
    suppressClick.current = false
    editor.endEdit()
    editor.selectOnly(clip.shot)
    event.currentTarget.focus({ preventScroll: true })
    const anchors = [
      0,
      editor.frame,
      ...editor.sequence.clips
        .filter((item) => item.shot !== clip.shot)
        .flatMap((item) => [item.start, item.start + item.duration])
    ]
    active.current = {
      clip: { ...clip },
      kind,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      scroll: scroll.current.scrollLeft,
      scale: canvas.current.getBoundingClientRect().width / span,
      anchors,
      clips: editor.sequence.clips,
      moved: false,
      snapping
    }
    // Touch already captures to the handle. Keep that native capture so a trim
    // does not retarget the gesture's final tap to the whole editing desk.
    if (event.pointerType === "mouse") root.current.setPointerCapture(event.pointerId)
    const tick = () => {
      const drag = active.current
      if (!drag || !scroll.current) return
      if (drag.moved) {
        const rect = scroll.current.getBoundingClientRect()
        const direction =
          drag.currentX < rect.left + 28 ? -1 : drag.currentX > rect.right - 28 ? 1 : 0
        if (direction && drag.currentY >= rect.top && drag.currentY <= rect.bottom) {
          scroll.current.scrollLeft += direction * 10
          update()
        }
      }
      animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }
  return {
    preview,
    begin,
    click: (shot: number) => {
      if (!suppressClick.current) editor.selectShot(shot)
      suppressClick.current = false
    },
    move: (event: PointerEvent<HTMLDivElement>) => {
      if (active.current?.pointerId === event.pointerId) {
        active.current.currentX = event.clientX
        active.current.currentY = event.clientY
        update()
      }
    },
    finish: (event: PointerEvent<HTMLDivElement>) => {
      const drag = active.current
      if (!drag || drag.pointerId !== event.pointerId) return
      drag.currentX = event.clientX
      drag.currentY = event.clientY
      update()
      const result = latest.current
      suppressClick.current = drag.moved
      stop()
      if (drag.moved && result) {
        if (result.valid) editor.editClip(result.clip)
        else
          editor.announce(
            "That space is occupied. Drop the clip in an empty space or on the other video track."
          )
      } else if (drag.kind === "move") editor.selectShot(drag.clip.shot)
    },
    cancel: () => {
      if (active.current) {
        suppressClick.current = true
        stop()
        editor.announce("Edit cancelled. The clip is back where it started.")
      }
    }
  }
}
