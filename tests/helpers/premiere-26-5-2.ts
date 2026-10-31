export const TICKS = 254016000000;
export const FRAME_NTSC_23976 = TICKS * 1001 / 24000;
export const FRAME_NTSC_2997 = TICKS * 1001 / 30000;

export class HostTime {
  private value = 0;
  constructor(ticks = 0) { this.value = Number(ticks); }
  get ticks() { return String(Math.round(this.value)); }
  set ticks(value: string) { this.value = Number(value); }
  get seconds() { return this.value / TICKS; }
  set seconds(value: number) { this.value = Number(value) * TICKS; }
  getFormatted(frameTime: HostTime, format: number) {
    const rate = Math.round(TICKS / Number(frameTime.ticks));
    let frames = Math.round(this.value / Number(frameTime.ticks));
    if (format === 109) return String(frames);
    if (format === 200) return String(Math.round(this.value * 48000 / TICKS));
    if (format === 201) return String(Math.round(this.value * 1000 / TICKS));
    const drop = format === 102 ? 2 : format === 106 ? 4 : 0;
    if (drop) {
      const tenMinutes = rate * 600 - drop * 9;
      const remainder = frames % tenMinutes;
      frames += drop * 9 * Math.floor(frames / tenMinutes) + drop * Math.floor(Math.max(0, remainder - drop) / (rate * 60 - drop));
    }
    const seconds = Math.floor(frames / rate);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frames % rate].map((part) => String(part).padStart(2, "0")).join(drop ? ";" : ":");
  }
}

export function collection<T>(source: T[] | (() => T[]), countName = "numItems"): any {
  return new Proxy({}, {
    get(_target, key) {
      const values = typeof source === "function" ? source() : source;
      if (key === countName || key === "length") return values.length;
      if (typeof key === "string" && /^\d+$/.test(key)) return values[Number(key)];
      return undefined;
    },
  });
}

export interface ItemOptions {
  name?: string; nodeId?: string; durationSeconds?: number; frameTicks?: number;
  hasVideo?: boolean; hasAudio?: boolean; soft?: boolean; softInSeconds?: number; softOutSeconds?: number;
  mediaPath?: string; metadata?: string; still?: boolean; ignoreMarks?: boolean; sampleRate?: number;
}
export interface ClipOptions {
  startSeconds?: number; inSeconds?: number; outSeconds?: number; durationSeconds?: number;
  trackIndex?: number; mediaType?: "Video" | "Audio"; linked?: boolean;
}

export function createHost2652() {
  let nextId = 1, frameTicks = TICKS / 25, seqIn = -400000, seqOut = -400000;
  let workEnabled = false, workIn = 0, workOut = 10, position = 0;
  const items: any[] = [], video: any[] = [], audio: any[] = [];
  const sampleTicks = TICKS / 48000;
  const floorGrid = (seconds: number, grid: number) => Math.floor((seconds * TICKS + 0.01) / grid) * grid;
  const floorBoundary = (seconds: number, grid: number) => {
    const units = seconds * TICKS / grid, nearest = Math.round(units);
    return units > 0 && Math.abs(units - nearest) < 1e-8 ? (nearest - 1) * grid : Math.floor(units) * grid;
  };
  const point = (ticks: number) => new HostTime(ticks);
  const xmlField = (name: string, value: string) => `<premierePrivateProjectMetaData:${name}> ${value} </premierePrivateProjectMetaData:${name}>`;
  function timecode(ticks: number, grid: number) {
    const nominal = Math.round(TICKS / grid), frames = Math.round(ticks / grid), seconds = Math.floor(frames / nominal);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frames % nominal].map((part) => String(part).padStart(2, "0")).join(":");
  }
  function addItem(options: ItemOptions = {}) {
    const audioOnly = options.hasVideo === false;
    const audioRate = options.sampleRate ?? 48000, itemSampleTicks = TICKS / audioRate;
    const grid = audioOnly ? itemSampleTicks : options.still ? TICKS / 25 : options.frameTicks ?? FRAME_NTSC_23976, duration = options.durationSeconds ?? (options.still ? 5 : 175.3417);
    let inTicks = 0, outTicks = options.soft ? duration * TICKS : floorGrid(duration, grid);
    const metadataIn = floorGrid(options.softInSeconds ?? 20, grid), metadataOut = floorGrid(options.softOutSeconds ?? 30, grid);
    const item: any = {
      nodeId: options.nodeId ?? `item-${nextId++}`, name: options.name ?? "Source", type: 1,
      hasVideo: options.hasVideo !== false, hasAudio: options.hasAudio !== false, frameTicks: grid,
      getInPoint: (mediaType = 4) => point((mediaType === 1 && options.hasVideo === false) || (mediaType === 2 && options.hasAudio === false) ? 0 : inTicks), getOutPoint: (mediaType = 4) => point((mediaType === 1 && options.hasVideo === false) || (mediaType === 2 && options.hasAudio === false) ? 0 : outTicks),
      markWrites: [] as { edge: string; seconds: number; mediaType: number }[],
      setInPoint(seconds: number, mediaType = 4) { item.markWrites.push({ edge: "in", seconds, mediaType }); if (!options.ignoreMarks && Number(seconds) >= 0 && Number(seconds) * TICKS < outTicks) inTicks = floorBoundary(Number(seconds), mediaType === 2 ? itemSampleTicks : audioOnly ? TICKS / 25 : grid); },
      setOutPoint(seconds: number, mediaType = 4) { item.markWrites.push({ edge: "out", seconds, mediaType }); if (!options.ignoreMarks && Number(seconds) * TICKS <= duration*TICKS + grid/2 && Number(seconds) * TICKS > inTicks) outTicks = floorBoundary(Number(seconds), mediaType === 2 ? itemSampleTicks : audioOnly ? TICKS / 25 : grid); },
      clearInPoint() { inTicks = 0; }, clearOutPoint() { outTicks = floorGrid(duration, grid); },
      getFootageInterpretation: () => ({ frameRate: audioOnly ? 2.75404699046078e-8 : TICKS / grid }),
      getMediaPath: () => options.mediaPath ?? "/fixture/source.mov",
      isSequence: () => false, isOffline: () => false,
      createSubClip(name: string, inside: string, outside: string) {
        return addItem({ ...options, name, nodeId: undefined, soft: true, softInSeconds: Number(inside)/TICKS, softOutSeconds: Number(outside)/TICKS });
      },
      getProjectMetadata() {
        if (options.metadata !== undefined) return options.metadata;
        let xml = xmlField("Column.Intrinsic.MediaDuration", timecode(duration*TICKS, grid)) + xmlField("Column.Intrinsic.MediaTimebase", options.hasVideo === false ? ` \n ${audioRate} Hz \t ` : `${TICKS / grid} fps`);
        if (audioOnly) xml += xmlField("Column.Intrinsic.MediaType", "Audio");
        if (options.still) xml += xmlField("Column.Intrinsic.MediaType", "Still Image");
        if (options.soft || audioOnly) {
          const field = (name: string, ticks: number) => `<premierePrivateProjectMetaData:${name}><rdf:value>${timecode(ticks, grid)}</rdf:value><premierePrivateProjectMetaData:frame_rate>${Math.round(grid)}</premierePrivateProjectMetaData:frame_rate></premierePrivateProjectMetaData:${name}>`;
          if (!audioOnly) xml += field("Column.Intrinsic.VideoInPoint", metadataIn) + field("Column.Intrinsic.VideoOutPoint", metadataOut - grid);
          const sampleTimecode = (ticks: number) => {
            const samples = Math.floor(ticks / itemSampleTicks), seconds = Math.floor(samples / audioRate);
            return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":") + ":" + String(samples % audioRate).padStart(5, "0");
          };
          if (audioOnly) {
            xml += '<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint><premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>';
            const audioField = (name: string, value: number) => `<premierePrivateProjectMetaData:${name}><rdf:value> \n ${sampleTimecode(value)} \t </rdf:value><premierePrivateProjectMetaData:frame_rate>10160640000</premierePrivateProjectMetaData:frame_rate></premierePrivateProjectMetaData:${name}>`;
            xml += audioField("Column.Intrinsic.AudioInPoint", options.soft ? metadataIn : inTicks) + audioField("Column.Intrinsic.AudioOutPoint", (options.soft ? metadataOut : outTicks) - itemSampleTicks);
          } else xml += xmlField("Column.Intrinsic.AudioInPoint", sampleTimecode(metadataIn)) + xmlField("Column.Intrinsic.AudioOutPoint", sampleTimecode(metadataOut - sampleTicks));
        }
        return `<rdf:RDF>${xml}</rdf:RDF>`;
      },
    };
    items.push(item); return item;
  }
  function makeClip(item: any, options: ClipOptions, kind: "Video" | "Audio") {
    let start = (options.startSeconds ?? 0) * TICKS;
    let sourceIn = options.inSeconds !== undefined ? options.inSeconds * TICKS : Number(item.getInPoint(kind === "Video" ? 1 : 2).ticks);
    let sourceOut = options.outSeconds !== undefined ? options.outSeconds * TICKS : Number(item.getOutPoint(kind === "Video" ? 1 : 2).ticks);
    let end = start + (options.durationSeconds !== undefined ? options.durationSeconds * TICKS : sourceOut - sourceIn);
    let selected = false;
    const numericTicks = (value: any) => typeof value === "object" ? Number(value.ticks) : Number(value);
    const clip: any = {
      nodeId: `clip-${nextId++}`, name: item.name, projectItem: item, mediaType: kind, disabled: false, components: collection([]), trackIndex: options.trackIndex ?? 0,
      get start() { return point(start); }, set start(value: any) { start = numericTicks(value); },
      get end() { return point(end); }, set end(value: any) { end = numericTicks(value); },
      get inPoint() { return point(sourceIn); }, set inPoint(value: any) { sourceIn = numericTicks(value); },
      get outPoint() { return point(sourceOut); }, set outPoint(value: any) { sourceOut = numericTicks(value); },
      get duration() { return point(end - start); },
      partners: [] as any[], getLinkedItems() { return this.partners.length ? collection([this, ...this.partners]) : null; },
      setSelected(value: boolean | number) { selected = !!value; return true; }, isSelected: () => selected,
      getSpeed: () => 1, isSpeedReversed: () => false, isAdjustmentLayer: () => false,
      resnap(grid: number) { start = Math.round(start / grid) * grid; end = Math.round(end / grid) * grid; },
      remove() { const list = kind === "Video" ? video : audio; const index = list.indexOf(clip); if (index >= 0) list.splice(index, 1); return true; },
    };
    (kind === "Video" ? video : audio).push(clip); return clip;
  }
  function linkClips(clips: any[]) { for (const clip of clips) clip.partners = clips.filter((other) => other !== clip); }
  function addClip(item: any, options: ClipOptions = {}) {
    const index = options.trackIndex ?? 0;
    while (videoTracks.length <= index) videoTracks.push(makeTrack("Video", videoTracks.length));
    while (audioTracks.length <= index) audioTracks.push(makeTrack("Audio", audioTracks.length));
    const kind = options.mediaType ?? "Video", clip = makeClip(item, options, kind);
    if (options.linked !== false && item.hasVideo && item.hasAudio) {
      const partner = makeClip(item, options, kind === "Video" ? "Audio" : "Video"); clip.partners = [partner]; partner.partners = [clip];
    }
    return clip;
  }
  const makeTrack = (kind: "Video" | "Audio", index = 0) => ({
    id: `${kind.toLowerCase()}-${index}`, name: `${kind} ${index + 1}`,
    transitions: { numItems: 0 },
    clips: collection(() => (kind === "Video" ? video : audio).filter((clip) => clip.trackIndex === index)), isLocked: () => false, isMuted: () => false, isTargeted: () => true,
    overwriteClip(item: any, ticks: string | HostTime) { return addClip(item, { startSeconds: Number(typeof ticks === "object" ? ticks.ticks : ticks) / TICKS, mediaType: kind, trackIndex: index }); },
    insertClip(item: any, ticks: string | HostTime) { return addClip(item, { startSeconds: Number(typeof ticks === "object" ? ticks.ticks : ticks) / TICKS, mediaType: kind, trackIndex: index }); },
  });
  const videoTracks = [makeTrack("Video")], audioTracks = [makeTrack("Audio")];
  let settings: any = { videoFrameRate: point(frameTicks), audioSampleRate: point(sampleTicks), videoDisplayFormat: 101, audioDisplayFormat: 200, videoFrameWidth: 1920, videoFrameHeight: 1080, videoPixelAspectRatio: 1 };
  const sequence: any = {
    _addClip: addClip,
    projectItem: { getFootageInterpretation: () => ({ frameRate: 2.75404699046078e-8 }), isSequence: () => true },
    sequenceID: "sequence-2652", name: "Host rules", videoTracks: collection(videoTracks, "numTracks"), audioTracks: collection(audioTracks, "numTracks"),
    get timebase() { return String(Math.round(frameTicks)); }, get end() { return String(Math.max(0, ...video.map((clip) => Number(clip.end.ticks)), ...audio.map((clip) => Number(clip.end.ticks)))); },
    get videoDisplayFormat() { return settings.videoDisplayFormat; }, set videoDisplayFormat(value: number) { settings.videoDisplayFormat = value; },
    getInPoint: () => String(seqIn), getOutPoint: () => String(seqOut),
    setInPoint(seconds: number) { seqIn = Number(seconds) === -400000 ? -400000 : floorGrid(Number(seconds), sampleTicks) / TICKS; },
    setOutPoint(seconds: number) { seqOut = Number(seconds) === -400000 ? -400000 : floorGrid(Number(seconds), sampleTicks) / TICKS; },
    getWorkAreaInPoint: () => String(workIn), getWorkAreaOutPoint: () => String(workOut),
    setWorkAreaInPoint(_seconds: number) {}, setWorkAreaOutPoint(_seconds: number) {},
    isWorkAreaEnabled: () => workEnabled, getWorkAreaEnabled: () => workEnabled, setWorkAreaEnabled(value: boolean) { workEnabled = !!value; },
    getPlayerPosition: () => point(position), setPlayerPosition(ticks: string) { position = Number(ticks); },
    getSelection: () => [...video, ...audio].filter((clip) => clip.isSelected()),
    unlinkSelection() {
      const selected = this.getSelection();
      if (selected.some((clip: any) => clip.partners.some((partner: any) => !partner.isSelected()))) return false;
      for (const clip of selected) { for (const partner of clip.partners) partner.partners = []; clip.partners = []; }
      return true;
    },
    getSettings: () => ({ ...settings }),
    setSettings(next: any) {
      const nextTicks = Number(next.videoFrameRate?.ticks ?? frameTicks);
      if (nextTicks !== frameTicks) { frameTicks = nextTicks; for (const clip of [...video, ...audio]) clip.resnap(frameTicks); }
      settings = { ...next, videoFrameRate: point(frameTicks) }; return true;
    },
    overwriteClip(item: any, ticks: string | HostTime, videoIndex = 0, audioIndex = videoIndex) {
      const kind = item.hasVideo ? "Video" : "Audio";
      const desiredIn = Number(item.getInPoint(item.hasVideo ? 1 : 2).ticks), desiredOut = Number(item.getOutPoint(item.hasVideo ? 1 : 2).ticks);
      const flooredIn = floorGrid(desiredIn / TICKS, frameTicks), flooredOut = floorGrid(desiredOut / TICKS, frameTicks);
      const clip = addClip(item, { startSeconds: Number(typeof ticks === "object" ? ticks.ticks : ticks) / TICKS, inSeconds: flooredIn / TICKS, outSeconds: flooredOut / TICKS, durationSeconds: Math.max(frameTicks, flooredOut - flooredIn) / TICKS, trackIndex: kind === "Video" ? videoIndex : audioIndex, mediaType: kind, linked: false });
      if (item.hasVideo && item.hasAudio) { const partner = addClip(item, { startSeconds: clip.start.seconds, inSeconds: clip.inPoint.seconds, outSeconds: clip.outPoint.seconds, durationSeconds: clip.duration.seconds, trackIndex: audioIndex, mediaType: "Audio", linked: false }); linkClips([clip, partner]); }
      return true;
    },
    insertClip(item: any, ticks: string | HostTime, videoIndex = 0, audioIndex = videoIndex) {
      const at = Number(typeof ticks === "object" ? ticks.ticks : ticks);
      const duration = Number(item.getOutPoint(item.hasVideo ? 1 : 2).ticks) - Number(item.getInPoint(item.hasVideo ? 1 : 2).ticks);
      for (const clip of [...video, ...audio]) if (Number(clip.start.ticks) >= at) { clip.start = String(Number(clip.start.ticks) + duration); clip.end = String(Number(clip.end.ticks) + duration); }
      return this.overwriteClip(item, ticks, videoIndex, audioIndex);
    },
  };
  const project: any = { documentID: "project-2652", activeSequence: sequence, rootItem: { nodeId: "root", name: "Root", type: 2, children: collection(items) }, sequences: collection([sequence], "numSequences") };
  const app: any = { project, sourceMonitor: { getProjectItem: () => items[0] ?? null }, enableQE() {} };
  const qe: any = { project: { getActiveSequence: () => {
    const active = project.activeSequence;
    const qeTrack = (kind: "Video" | "Audio", index: number) => ({
      isSyncLocked: () => true,
      razor(timecode: string) {
        const parts = timecode.split(/[:;]/).map(Number), nominal = Math.round(TICKS / Number(active.timebase));
        let frames = ((parts[0]*3600+parts[1]*60+parts[2])*nominal+parts[3]);
        if (timecode.includes(";")) frames -= Math.round(nominal/15) * ((parts[0]*60+parts[1])-Math.floor((parts[0]*60+parts[1])/10));
        const at = frames * Number(active.timebase), clips = kind === "Video" ? active.videoTracks[index].clips : active.audioTracks[index].clips;
        for (let n=0;n<clips.numItems;n++) { const clip=clips[n]; if (Number(clip.start.ticks)<at && Number(clip.end.ticks)>at) {
          const oldEnd=Number(clip.end.ticks), oldOut=Number(clip.outPoint.ticks), split=Number(clip.inPoint.ticks)+at-Number(clip.start.ticks);
          clip.end=String(at);clip.outPoint=String(split);active._addClip(clip.projectItem,{startSeconds:at/TICKS,inSeconds:split/TICKS,outSeconds:oldOut/TICKS,durationSeconds:(oldEnd-at)/TICKS,mediaType:kind,trackIndex:index,linked:false});break;
        }}
      }
    });
    return { guid: active.sequenceID, undoStackIndex: 0, getVideoTrackAt: (i: number) => qeTrack("Video",i), getAudioTrackAt: (i: number) => qeTrack("Audio",i) };
  } } };
  return { app, qe, sequence, project, video, audio, items, addItem, addClip, linkClips };

}

// Observe both documented placement routes; single-kind copies use the track.
export function observeHostOverwrite(host: ReturnType<typeof createHost2652>, after: () => void) {
  let calls = 0;
  const targets = [host.sequence];
  for (const tracks of [host.sequence.videoTracks, host.sequence.audioTracks]) {
    for (let i = 0; i < tracks.numTracks; i++) targets.push(tracks[i]);
  }
  for (const target of targets) {
    const overwrite = target.overwriteClip;
    target.overwriteClip = function (...args: unknown[]) {
      const result = overwrite.apply(this, args);
      calls++;
      after();
      return result;
    };
  }
  return () => calls;
}
