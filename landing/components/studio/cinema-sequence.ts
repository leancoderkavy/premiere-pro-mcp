export type CinemaClip = {
  shot: number
  start: number
  track: number
  sourceIn: number
  duration: number
}
export type CinemaMarker = { frame: number; name: string }
export type CinemaSequence = { clips: CinemaClip[]; markers: CinemaMarker[] }

export const clipNames = ["A moment of stillness", "Follow the coastline", "Into the blue"]
export const sourceFrames = 192
export const maxTimelineFrames = 1440
export const initialClips: CinemaClip[] = [0, 1, 2].map((shot) => ({
  shot,
  start: shot * 192,
  track: 0,
  sourceIn: 0,
  duration: 192
}))
export const initialSequence: CinemaSequence = { clips: initialClips, markers: [] }
export const totalFrames = (clips: CinemaClip[]) =>
  Math.max(24, ...clips.map((clip) => clip.start + clip.duration))
export const clipStart = (clips: CinemaClip[], shot: number) => {
  return clips.find((clip) => clip.shot === shot)?.start ?? 0
}
export function shotAtFrame(clips: CinemaClip[], frame: number) {
  return (
    [...clips]
      .sort((a, b) => b.track - a.track)
      .find((clip) => frame >= clip.start && frame < clip.start + clip.duration)?.shot ?? null
  )
}
export function reorderClips(clips: CinemaClip[], shot: number, destination: number) {
  const next = [...clips]
  const from = next.findIndex((clip) => clip.shot === shot)
  const [clip] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, destination)), 0, clip)
  const cursors = [0, 0]
  return next.map((item) => {
    if (item.track !== clip.track) return item
    const start = cursors[item.track]
    cursors[item.track] += item.duration
    return { ...item, start }
  })
}

export function canPlaceClip(clips: CinemaClip[], candidate: CinemaClip) {
  return (
    candidate.start >= 0 &&
    candidate.start + candidate.duration <= maxTimelineFrames &&
    candidate.duration >= 24 &&
    candidate.sourceIn >= 0 &&
    candidate.sourceIn + candidate.duration <= sourceFrames &&
    [0, 1].includes(candidate.track) &&
    !clips.some(
      (other) =>
        other.shot !== candidate.shot &&
        other.track === candidate.track &&
        candidate.start < other.start + other.duration &&
        candidate.start + candidate.duration > other.start
    )
  )
}

export function placeClip(sequence: CinemaSequence, candidate: CinemaClip): CinemaSequence | null {
  if (!canPlaceClip(sequence.clips, candidate)) return null
  const clips = sequence.clips
    .map((clip) => (clip.shot === candidate.shot ? candidate : clip))
    .sort((a, b) => a.start - b.start || b.track - a.track)
  return {
    clips,
    markers: sequence.markers.map((marker) => ({
      ...marker,
      frame: Math.min(marker.frame, totalFrames(clips) - 1)
    }))
  }
}

export function snapFrame(value: number, anchors: number[], tolerance: number) {
  const nearest = anchors.reduce(
    (best, frame) => (Math.abs(frame - value) < Math.abs(best - value) ? frame : best),
    Infinity
  )
  return Math.abs(nearest - value) <= tolerance ? nearest : null
}
export function resizeClip(
  sequence: CinemaSequence,
  shot: number,
  duration: number
): CinemaSequence {
  const original = sequence.clips.find((clip) => clip.shot === shot)!
  const bounded = Math.max(24, Math.min(sourceFrames - original.sourceIn, Math.round(duration)))
  const delta = bounded - original.duration
  const clips = sequence.clips.map((clip) =>
    clip.shot === shot
      ? { ...clip, duration: bounded }
      : clip.track === original.track && clip.start >= original.start + original.duration
        ? { ...clip, start: clip.start + delta }
        : clip
  )
  if (totalFrames(clips) > maxTimelineFrames) return sequence
  // Review markers remain within the shortened demo sequence.
  const end = totalFrames(clips) - 1
  return {
    clips,
    markers: sequence.markers.map((marker) => ({ ...marker, frame: Math.min(marker.frame, end) }))
  }
}

export type DemoRequest = "trim" | "reorder" | "marker"
export type DemoPlan = {
  prompt: string
  summary: string
  tools: string
  calls: { tool: string; arguments: Record<string, string | number> }[]
  next: CinemaSequence
  frame: number
}

/** Scripted examples use real tool names and parameters, with clearly fictional clip IDs. */
export function planDemoRequest(
  kind: DemoRequest,
  sequence: CinemaSequence,
  frame: number
): DemoPlan {
  const calls: DemoPlan["calls"] = [{ tool: "get_sequence_structure", arguments: {} }]
  let next = sequence
  let focus = frame
  let prompt = "Add a review marker at the playhead."
  let summary = "Review marker added at the playhead."
  let tools = "Read sequence → add marker → read markers"
  if (kind === "trim") {
    prompt = "Trim the opening shot to 4 seconds and close the gap."
    const first = sequence.clips[0]
    const sourceReset = {
      ...sequence,
      clips: sequence.clips.map((clip) =>
        clip.shot === first.shot ? { ...clip, sourceIn: 0 } : clip
      )
    }
    next = resizeClip(sourceReset, first.shot, 96)
    if (first.sourceIn !== 0)
      calls.push({
        tool: "trim_clip",
        arguments: { node_id: `demo-shot-${first.shot + 1}`, new_in_seconds: 0 }
      })
    calls.push({
      tool: "trim_clip",
      arguments: { node_id: `demo-shot-${first.shot + 1}`, new_out_seconds: 4 }
    })
    sequence.clips.slice(1).forEach((clip) =>
      calls.push({
        tool: "move_clip",
        arguments: {
          node_id: `demo-shot-${clip.shot + 1}`,
          new_start_seconds: clipStart(next.clips, clip.shot) / 24
        }
      })
    )
    sequence.markers.forEach((marker, index) => {
      if (marker.frame !== next.markers[index].frame) {
        calls.push({ tool: "delete_marker", arguments: { time_seconds: marker.frame / 24 } })
        calls.push({
          tool: "add_marker",
          arguments: { time_seconds: next.markers[index].frame / 24, name: marker.name }
        })
      }
    })
    focus = first.start + 48
    summary = `Opening trimmed to 4s. Following shots moved to close the gap.${sequence.markers.some((marker, index) => marker.frame !== next.markers[index].frame) ? " End markers moved inside the new duration." : ""}`
    tools = "Read sequence → trim & move → read sequence"
  } else if (kind === "reorder") {
    prompt = "Put the blue shot first. Keep all three shots."
    next = {
      ...sequence,
      clips: reorderClips(
        sequence.clips.map((clip) => ({ ...clip, track: 0 })),
        2,
        0
      )
    }
    next.clips.forEach((clip) =>
      calls.push({
        tool: "move_clip",
        arguments: {
          node_id: `demo-shot-${clip.shot + 1}`,
          new_start_seconds: clipStart(next.clips, clip.shot) / 24,
          ...(sequence.clips.find((item) => item.shot === clip.shot)?.track === 1
            ? { new_track_index: 0 }
            : {})
        }
      })
    )
    focus = 48
    summary = "Into the blue now opens the film. All three shots are still in the sequence."
    tools = "Read sequence → move clips → read sequence"
  } else {
    const marker = { frame, name: "Review this frame" }
    if (sequence.markers.some((item) => item.frame === frame)) {
      summary = "There is already a review marker at this frame. Scrub to another frame to add one."
      tools = "Read sequence → check existing markers"
    } else if (sequence.markers.length >= 12) {
      summary = "This demo holds 12 review markers. Undo an edit or reset to try again."
      tools = "Read sequence → check existing markers"
    } else {
      next = { ...sequence, markers: [...sequence.markers, marker] }
      calls.push({
        tool: "add_marker",
        arguments: { time_seconds: frame / 24, name: marker.name, color: 3 }
      })
    }
  }
  calls.push(
    kind === "marker"
      ? { tool: "get_sequence_markers_by_type", arguments: { marker_type: "Comment" } }
      : { tool: "get_sequence_structure", arguments: {} }
  )
  return { prompt, summary, tools, calls, next, frame: focus }
}
