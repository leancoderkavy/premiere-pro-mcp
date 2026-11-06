import { createContext, runInContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

/**
 * A small fake of the Premiere DOM pieces the caption tools touch: a sequence with video tracks,
 * importMGT creating MOGRT clips with text / colour controls and a Motion component, a root bin with
 * importFiles, and caption-track creation. It runs generated ExtendScript in a vm after the real
 * helpers; it proves script logic, not Premiere's behaviour.
 */

export const TPS = 254016000000;

export interface FakeHostOptions {
  fps?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  videoTracks?: number;
  lockedTracks?: number[];
  /** importMGT call numbers (1-based) that return null. */
  importFailsAt?: number[];
  /** importMGT call numbers that throw. */
  importThrowsAt?: number[];
  /** Text control display names whose setValue is ignored. */
  ignoreTextFor?: string[];
  /** Template text JSON. Default has fontSizeEditValue 60 and capPropFontSizeEdit true. */
  textJson?: (text: string) => string;
  /** Template default clip length in seconds. */
  mogrtSeconds?: number;
  /** Throw from clip.end assignments (the clip stays at its default length). */
  endWriteThrows?: boolean;
  /** Land every clip.end assignment this many ticks off (default 0). */
  endWriteSkew?: number;
  /** Fields (display names) the template exposes. Default Line 1, Line 2, Text, Color. */
  controls?: string[];
  /** clip.remove throws for names listed. */
  removeFails?: string[];
  /** Removal does nothing (clips stay). */
  removeIsNoop?: boolean;
  /** Colour getColorValue returns this instead. */
  colorReadback?: number[] | null;
  /** Position setValue is ignored. */
  ignorePosition?: boolean;
  /** Clip name assignment is ignored. */
  ignoreName?: boolean;
  /** Existing clips placed before the run. */
  existing?: Array<{ track: number; name: string; start: number; end: number }>;
  /** Caption track counts before / after createCaptionTrack. */
  captionTracks?: { before?: unknown; after?: unknown };
  createCaptionReturns?: boolean;
  /** importFiles creates no item. */
  importFilesNoItem?: boolean;
  /** importFiles throws. */
  importFilesThrows?: boolean;
  /** new File(path).exists is false. */
  fileMissing?: boolean;
  /** getMediaPath returns the path upper-cased. */
  mediaPathUpper?: boolean;
}

export interface FakeClip {
  nodeId: string;
  name: string;
  _start: number;
  _end: number;
  texts: Record<string, string>;
  colorValue: number[] | null;
  motion: { position: number[]; scale: number };
}

export function makeFakeCaptionHost(options: FakeHostOptions = {}) {
  const fps = options.fps ?? 25;
  const frameTicks = Math.round(TPS / fps);
  const width = options.width ?? 1080;
  const height = options.height ?? 1920;
  const trackCount = options.videoTracks ?? 3;
  const controls = options.controls ?? ["Line 1", "Line 2", "Text", "Color"];
  const log = { imports: 0, removes: 0, captionCreates: 0, importFiles: [] as string[], writes: [] as string[] };
  let nextId = 1;

  // Arrays handed to the script must belong to its realm (the helpers test instanceof Array).
  const holder: { make?: (...items: number[]) => number[] } = {};
  const ctxArray = (items: number[]) => holder.make!(...items);

  const withCount = <T,>(arr: T[]) => {
    Object.defineProperty(arr, "numItems", { get: () => arr.length, enumerable: false });
    return arr as T[] & { numItems: number };
  };

  const tracks = Array.from({ length: trackCount }, (_, index) => {
    const clips = withCount<any>([]);
    return { index, clips, isLocked: () => (options.lockedTracks ?? []).includes(index) };
  });
  const videoTracks: any = Object.assign({}, tracks, { numTracks: trackCount });

  function textParam(clip: FakeClip, name: string) {
    return {
      displayName: name,
      getValue: () => (options.textJson ?? ((t: string) => JSON.stringify({ textEditValue: t, fontSizeEditValue: (clip as any)[`fontSize:${name}`] ?? 60, capPropFontSizeEdit: true })))(clip.texts[name] ?? ""),
      setValue(value: unknown) {
        if (options.ignoreTextFor?.includes(name)) return;
        try {
          const parsed = JSON.parse(String(value));
          clip.texts[name] = parsed.textEditValue;
          if (parsed.fontSizeEditValue !== undefined) (clip as any)[`fontSize:${name}`] = parsed.fontSizeEditValue;
        } catch {
          clip.texts[name] = String(value);
        }
        log.writes.push(`${clip.nodeId}:${name}`);
      },
    };
  }

  function makeClip(track: number, start: number, end: number, name: string): any {
    const clip: FakeClip = { nodeId: `clip-${nextId++}`, name, _start: start, _end: end, texts: {}, colorValue: null, motion: { position: [0.5, 0.5], scale: 100 } };
    const textProps = new Map<string, any>();
    const properties: any = {};
    controls.forEach((control, i) => {
      let prop: any;
      if (control === "Color") {
        prop = {
          displayName: control,
          getValue: () => 0,
          setValue: () => {},
          setColorValue(a: number, r: number, g: number, b: number) { clip.colorValue = [a, r, g, b]; },
          getColorValue: () => { const v = options.colorReadback !== undefined ? options.colorReadback : clip.colorValue; return v ? ctxArray(v) : v; },
        };
      } else {
        prop = textParam(clip, control);
        textProps.set(control, prop);
      }
      properties[i] = prop;
    });
    properties.numItems = controls.length;
    const motionProps = [
      { displayName: "Position", getValue: () => ctxArray(clip.motion.position), setValue: (v: number[]) => { if (!options.ignorePosition) clip.motion.position = v.slice(); } },
      { displayName: "Scale", getValue: () => clip.motion.scale, setValue: (v: number) => { clip.motion.scale = v; } },
      { displayName: "Uniform Scale", getValue: () => true, setValue: () => {} },
    ];
    const motion: any = { matchName: "AE.ADBE Motion", displayName: "Motion", properties: Object.assign({}, motionProps, { numItems: motionProps.length }) };
    const api: any = {
      nodeId: clip.nodeId,
      _clip: clip,
      track,
      get name() { return clip.name; },
      set name(value: string) { if (!options.ignoreName) clip.name = value; },
      get start() { return { ticks: String(clip._start) }; },
      set start(v: any) { clip._start = parseFloat(v && v.ticks !== undefined ? v.ticks : v); },
      get end() { return { ticks: String(clip._end) }; },
      set end(v: any) {
        if (options.endWriteThrows) throw new Error("end is read-only");
        clip._end = parseFloat(v && v.ticks !== undefined ? v.ticks : v) + (options.endWriteSkew ?? 0);
      },
      components: Object.assign({ 0: motion }, { numItems: 1 }),
      getMGTComponent: () => ({ properties }),
      remove() {
        if (options.removeFails?.includes(clip.name)) throw new Error("remove refused");
        log.removes++;
        if (options.removeIsNoop) return;
        const arr = tracks[track].clips;
        const at = arr.indexOf(api);
        if (at >= 0) arr.splice(at, 1);
      },
    };
    return api;
  }

  for (const e of options.existing ?? []) tracks[e.track].clips.push(makeClip(e.track, Math.round(e.start * TPS), Math.round(e.end * TPS), e.name));

  const seq: any = {
    sequenceID: "seq-1",
    name: "Reel: Final/Cut",
    timebase: String(frameTicks),
    end: String(Math.round((options.durationSeconds ?? 120) * TPS)),
    frameSizeHorizontal: width,
    frameSizeVertical: height,
    videoTracks,
    importMGT(_path: string, ticks: string, trackIndex: number) {
      log.imports++;
      if (options.importThrowsAt?.includes(log.imports)) throw new Error("importMGT exploded");
      if (options.importFailsAt?.includes(log.imports)) return null;
      const start = parseFloat(ticks);
      const clip = makeClip(trackIndex, start, start + Math.round((options.mogrtSeconds ?? 5) * TPS), "Template");
      tracks[trackIndex].clips.push(clip);
      return clip;
    },
    createCaptionTrack(item: unknown) {
      log.captionCreates++;
      void item;
      captionState.created = true;
      return options.createCaptionReturns ?? true;
    },
    getCaptionTracks: () => {
      const counts = options.captionTracks ?? {};
      if (captionState.created) return { numTracks: "after" in counts ? counts.after : 1 };
      return { numTracks: "before" in counts ? counts.before : 0 };
    },
  };
  const captionState = { created: false };

  const root: any = { children: withCount<any>([]), type: 3 };
  const project: any = {
    activeSequence: seq,
    rootItem: root,
    sequences: Object.assign({ 0: seq }, { numSequences: 1 }),
    importFiles(paths: string[]) {
      log.importFiles.push(...paths);
      if (options.importFilesThrows) throw new Error("import exploded");
      if (options.importFilesNoItem) return true;
      for (const p of paths) {
        root.children.push({ nodeId: `item-${nextId++}`, name: String(p).split(/[\\/]/).pop(), type: 1, getMediaPath: () => (options.mediaPathUpper ? String(p).toUpperCase() : p) });
      }
      return true;
    },
  };
  const context = {
    app: { project, enableQE() {} },
    Time: class { ticks = "0"; },
    File: class { fsName: string; exists = !options.fileMissing; constructor(p: string) { this.fsName = p; } },
    $: { os: "Windows" },
    Sequence: { CAPTION_FORMAT_SUBTITLE: 1, CAPTION_FORMAT_608: 2, CAPTION_FORMAT_708: 3, CAPTION_FORMAT_TELETEXT: 4, CAPTION_FORMAT_OPEN_EBU: 5, CAPTION_FORMAT_OP42: 6, CAPTION_FORMAT_OP47: 7 },
  };

  const vmContext = createContext(context);
  holder.make = runInContext("(function () { return Array.prototype.slice.call(arguments); })", vmContext);
  const run = (script: string) => JSON.parse(String(runInContext(`${getHelpersSource()}
${script}`, vmContext)));
  return { run, tracks, seq, log, project, root, frameTicks, context, makeClip };
}
