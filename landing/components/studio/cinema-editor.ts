"use client"

import { useEffect, useRef, useState } from "react"
import { timecode, useSequenceTransport } from "./cinema-interaction"
import {
  clipStart,
  initialSequence,
  planDemoRequest,
  reorderClips,
  resizeClip,
  totalFrames,
  placeClip,
  shotAtFrame,
  type CinemaClip,
  type CinemaSequence,
  type DemoPlan,
  type DemoRequest
} from "./cinema-sequence"

export function useCinemaEditor(visible: boolean) {
  const [history, setHistory] = useState<{
    past: CinemaSequence[]
    present: CinemaSequence
    future: CinemaSequence[]
  }>({
    past: [],
    present: initialSequence,
    future: []
  })
  const [selectedShot, setSelectedShot] = useState(1)
  const [phase, setPhase] = useState(0)
  const [plan, setPlan] = useState<DemoPlan | null>(null)
  const [notice, setNotice] = useState("Choose a request, or select a clip and make an edit.")
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const gesture = useRef({ active: false, saved: false })
  const transport = useSequenceTransport(visible, history.present.clips)
  const busy = phase > 0 && phase < 4
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const commit = (next: CinemaSequence, frame: number) => {
    if (JSON.stringify(next) === JSON.stringify(history.present)) {
      transport.seek(frame, totalFrames(next.clips))
      return
    }
    const save = !gesture.current.active || !gesture.current.saved
    gesture.current.saved = true
    setHistory((previous) => ({
      past: save ? [...previous.past, previous.present].slice(-30) : previous.past,
      present: next,
      future: []
    }))
    transport.seek(frame, totalFrames(next.clips))
  }
  const manual = (next: CinemaSequence, shot: number, message: string) => {
    if (busy) return
    if (JSON.stringify(next) === JSON.stringify(history.present)) return
    const clip = next.clips.find((item) => item.shot === shot)!
    setSelectedShot(shot)
    commit(next, clipStart(next.clips, shot) + Math.min(48, clip.duration - 1))
    setPhase(0)
    setPlan(null)
    setNotice(message)
  }
  const request = (kind: DemoRequest) => {
    if (busy) return
    const nextPlan = planDemoRequest(kind, history.present, transport.frame)
    transport.seek(transport.frame)
    gesture.current.active = false
    timers.current.forEach(clearTimeout)
    setPlan(nextPlan)
    setPhase(1)
    setNotice("Demo: the assistant reads the active sequence.")
    timers.current = [
      setTimeout(() => {
        setPhase(2)
        setNotice("Demo: MCP sends the edit through the local Premiere bridge.")
      }, 450),
      setTimeout(() => {
        commit(nextPlan.next, nextPlan.frame)
        setSelectedShot(
          shotAtFrame(nextPlan.next.clips, nextPlan.frame) ?? nextPlan.next.clips[0].shot
        )
        setPhase(3)
        setNotice("Demo: Premiere returns the updated state for the assistant to check.")
      }, 950),
      setTimeout(() => {
        setPhase(4)
        setNotice(nextPlan.summary)
      }, 1450)
    ]
  }
  return {
    ...transport,
    selectedShot,
    selectOnly: (shot: number) => {
      setSelectedShot(shot)
      transport.seek(transport.frame)
    },
    selectShot: (shot: number) => {
      setSelectedShot(shot)
      transport.selectShot(shot)
    },
    seek: (frame: number) => {
      transport.seek(frame)
      const active = shotAtFrame(history.present.clips, frame)
      if (active !== null) setSelectedShot(active)
    },
    sequence: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    busy,
    phase,
    plan,
    notice,
    request,
    beginEdit: () => {
      gesture.current = { active: true, saved: false }
      transport.seek(transport.frame)
    },
    endEdit: () => {
      gesture.current.active = false
    },
    editClip: (clip: CinemaClip) => {
      const next = placeClip(history.present, clip)
      if (next)
        manual(
          next,
          clip.shot,
          `Clip ${clip.shot + 1} on V${clip.track + 1} at ${timecode(clip.start)}. Duration ${timecode(clip.duration)}.`
        )
      else
        setNotice(
          "That space is occupied. Drop the clip in an empty space or on the other video track."
        )
    },
    announce: (message: string) => setNotice(message),
    resize: (shot: number, duration: number) =>
      manual(
        resizeClip(history.present, shot, duration),
        shot,
        "Clip duration updated. Following shots close the gap; end markers stay inside the edit."
      ),
    reorder: (shot: number, destination: number) =>
      manual(
        { ...history.present, clips: reorderClips(history.present.clips, shot, destination) },
        shot,
        "Shot order updated. Play the sequence to review your cut."
      ),
    undo: () => {
      if (busy || !history.past.length) return
      const previous = history.past[history.past.length - 1]
      setHistory({
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future].slice(0, 30)
      })
      transport.seek(0, totalFrames(previous.clips))
      setSelectedShot(shotAtFrame(previous.clips, 0) ?? previous.clips[0].shot)
      setPhase(0)
      setPlan(null)
      setNotice("Last edit undone.")
    },
    redo: () => {
      if (busy || !history.future.length) return
      const next = history.future[0]
      setHistory({
        past: [...history.past, history.present].slice(-30),
        present: next,
        future: history.future.slice(1)
      })
      transport.seek(0, totalFrames(next.clips))
      setSelectedShot(shotAtFrame(next.clips, 0) ?? next.clips[0].shot)
      setPhase(0)
      setPlan(null)
      setNotice("Edit redone.")
    },
    reset: () => {
      if (busy) return
      setHistory({ past: [], present: initialSequence, future: [] })
      transport.seek(240, totalFrames(initialSequence.clips))
      setSelectedShot(1)
      setPhase(0)
      setPlan(null)
      setNotice("Original 24-second sequence restored.")
    }
  }
}

export type CinemaEditor = ReturnType<typeof useCinemaEditor>
