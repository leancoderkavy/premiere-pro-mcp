export type CinemaClip = { shot: number; duration: number }
export type CinemaMarker = { frame: number; name: string }
export type CinemaSequence = { clips: CinemaClip[]; markers: CinemaMarker[] }

export const clipNames = ["A moment of stillness", "Follow the coastline", "Into the blue"]
export const initialClips: CinemaClip[] = [0, 1, 2].map((shot) => ({ shot, duration: 192 }))
export const initialSequence: CinemaSequence = { clips: initialClips, markers: [] }
export const totalFrames = (clips: CinemaClip[]) =>
  clips.reduce((sum, clip) => sum + clip.duration, 0)
export const clipStart = (clips: CinemaClip[], shot: number) => {
  const index = clips.findIndex((clip) => clip.shot === shot)
  return totalFrames(clips.slice(0, Math.max(0, index)))
}
export function shotAtFrame(clips: CinemaClip[], frame: number) {
  let end = 0
  return (
    clips.find((clip) => {
      end += clip.duration
      return frame < end
    }) ?? clips[clips.length - 1]
  ).shot
}
export function reorderClips(clips: CinemaClip[], shot: number, destination: number) {
  const next = [...clips]
  const from = next.findIndex((clip) => clip.shot === shot)
  const [clip] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, destination)), 0, clip)
  return next
}
export function resizeClip(
  sequence: CinemaSequence,
  shot: number,
  duration: number
): CinemaSequence {
  const clips = sequence.clips.map((clip) =>
    clip.shot === shot
      ? { ...clip, duration: Math.max(48, Math.min(192, Math.round(duration))) }
      : clip
  )
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
    next = resizeClip(sequence, first.shot, 96)
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
    focus = 48
    summary = `Opening trimmed to 4s. Following shots moved to close the gap.${sequence.markers.some((marker, index) => marker.frame !== next.markers[index].frame) ? " End markers moved inside the new duration." : ""}`
    tools = "Read sequence → trim & move → read sequence"
  } else if (kind === "reorder") {
    prompt = "Put the blue shot first. Keep all three shots."
    next = { ...sequence, clips: reorderClips(sequence.clips, 2, 0) }
    next.clips.forEach((clip) =>
      calls.push({
        tool: "move_clip",
        arguments: {
          node_id: `demo-shot-${clip.shot + 1}`,
          new_start_seconds: clipStart(next.clips, clip.shot) / 24
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
