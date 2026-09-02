export type SilenceRange = { startSeconds: number; endSeconds: number };
export type FrameRange = { startFrame: number; endFrame: number };

export type SilenceRemovalPlan = {
  frameRate: number;
  totalFrames: number;
  removedFrames: number;
  keptFrames: number;
  removalRanges: FrameRange[];
  keepRanges: FrameRange[];
};

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

export function planDerivedSilenceRemoval(input: {
  durationSeconds: number;
  frameRate: number;
  silenceRanges: SilenceRange[];
  keepHandleFrames?: number;
  maximumRemovals?: number;
}): SilenceRemovalPlan {
  const duration = finite(input.durationSeconds, "durationSeconds");
  const frameRate = finite(input.frameRate, "frameRate");
  if (duration <= 0 || frameRate <= 0) throw new Error("durationSeconds and frameRate must be positive");
  if (!Array.isArray(input.silenceRanges)) throw new Error("silenceRanges must be an array");
  const keepHandleFrames = input.keepHandleFrames ?? 0;
  const maximumRemovals = input.maximumRemovals ?? 256;
  if (!Number.isInteger(keepHandleFrames) || keepHandleFrames < 0 || keepHandleFrames > 2400) throw new Error("keepHandleFrames must be an integer between 0 and 2400");
  if (!Number.isInteger(maximumRemovals) || maximumRemovals < 1 || maximumRemovals > 512) throw new Error("maximumRemovals must be an integer between 1 and 512");

  const totalFrames = Math.floor(duration * frameRate + 1e-7);
  if (totalFrames < 1) throw new Error("media duration is shorter than one frame");
  const snappedSilenceRanges: FrameRange[] = [];
  for (let index = 0; index < input.silenceRanges.length; index += 1) {
    const range = input.silenceRanges[index];
    const start = finite(range?.startSeconds, `silenceRanges[${index}].startSeconds`);
    const end = finite(range?.endSeconds, `silenceRanges[${index}].endSeconds`);
    if (start < 0 || end <= start || end > duration + 1e-7) throw new Error(`silenceRanges[${index}] is outside the media duration`);
    const startFrame = Math.max(0, Math.ceil(start * frameRate - 1e-7));
    const endFrame = Math.min(totalFrames, Math.floor(end * frameRate + 1e-7));
    if (endFrame > startFrame) snappedSilenceRanges.push({ startFrame, endFrame });
  }
  snappedSilenceRanges.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  const mergedSilenceRanges: FrameRange[] = [];
  for (const candidate of snappedSilenceRanges) {
    const previous = mergedSilenceRanges.at(-1);
    if (previous && candidate.startFrame <= previous.endFrame) previous.endFrame = Math.max(previous.endFrame, candidate.endFrame);
    else mergedSilenceRanges.push({ ...candidate });
  }
  const removalRanges: FrameRange[] = [];
  for (const silence of mergedSilenceRanges) {
    const startFrame = silence.startFrame + keepHandleFrames;
    const endFrame = silence.endFrame - keepHandleFrames;
    if (endFrame > startFrame) removalRanges.push({ startFrame, endFrame });
  }
  if (removalRanges.length > maximumRemovals) throw new Error(`silence plan exceeds maximumRemovals (${maximumRemovals})`);

  const keepRanges: FrameRange[] = [];
  let cursor = 0;
  for (const removal of removalRanges) {
    if (removal.startFrame > cursor) keepRanges.push({ startFrame: cursor, endFrame: removal.startFrame });
    cursor = removal.endFrame;
  }
  if (cursor < totalFrames) keepRanges.push({ startFrame: cursor, endFrame: totalFrames });
  if (!keepRanges.length) throw new Error("silence plan would remove the entire source");
  const removedFrames = removalRanges.reduce((sum, range) => sum + range.endFrame - range.startFrame, 0);
  return { frameRate, totalFrames, removedFrames, keptFrames: totalFrames - removedFrames, removalRanges, keepRanges };
}
