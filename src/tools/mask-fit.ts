import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions, CommandResult } from "../bridge/file-bridge.js";
import {
  computeMaskFitMotion,
  interpretMaskProperties,
  looksNormalizedPoint,
  validateNormalizedBox,
  type FitAxis,
  type MaskInterpretation,
  type MaskPlacement,
  type NormalizedBox,
  type RawEffectProperty,
} from "../ai/mask-fit.js";

const MAX_EFFECT_NAME_LENGTH = 128;
const MAX_NODE_ID_LENGTH = 256;
const MAX_FRAME_DIMENSION = 32768;

function boxParameter(description: string, allowOutside = false) {
  const range = allowOutside ? { minimum: -1, maximum: 2 } : { minimum: 0, maximum: 1 };
  return {
    type: "object",
    additionalProperties: false,
    description,
    properties: {
      left: { type: "number", ...range, description: "Left edge as a fraction of the frame width." },
      top: { type: "number", ...range, description: "Top edge as a fraction of the frame height." },
      right: { type: "number", ...range, description: "Right edge as a fraction of the frame width." },
      bottom: { type: "number", ...range, description: "Bottom edge as a fraction of the frame height." },
    },
    required: ["left", "top", "right", "bottom"],
  } as const;
}

export interface ComputeMaskFitArgs {
  node_id: string;
  subject: NormalizedBox;
  mask_effect?: string;
  mask_node_id?: string;
  mask_space?: "sequence" | "clip";
  mask_override?: NormalizedBox;
  placement?: Partial<MaskPlacement>;
  fit_axis?: FitAxis;
  source_width?: number;
  source_height?: number;
  source_prescale?: number;
}

interface HostProperty {
  name: string;
  value: unknown;
  timeVarying?: boolean;
}

interface HostReadback {
  clip?: { name?: string; nodeId?: string; trackIndex?: number };
  sequence?: { width?: number; height?: number };
  source?: { name?: string; width?: number | null; height?: number | null; pixelAspectRatio?: number | null; sizeSource?: string | null };
  motion?: { found?: boolean; properties?: HostProperty[] };
  mask?: { found?: boolean; clipName?: string; componentName?: string; matchName?: string; properties?: HostProperty[] };
  components?: string[];
  maskClipComponents?: string[];
}

function findHostProperty(properties: readonly HostProperty[] | undefined, name: string): HostProperty | undefined {
  return properties?.find((prop) => prop.name.toLowerCase() === name.toLowerCase());
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPoint(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [x, y] = value;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

function buildReadScript(args: ComputeMaskFitArgs, maskEffect: string): string {
  const nodeId = escapeForExtendScript(args.node_id);
  const maskNodeId = escapeForExtendScript(args.mask_node_id ?? args.node_id);
  const effect = escapeForExtendScript(maskEffect.toLowerCase());
  const readMask = args.mask_override ? "false" : "true";
  return buildToolScript(`
    function __mfClean(text) {
      return String(text).replace(/[\\u0000-\\u001f\\u007f"\\\\]/g, " ").substring(0, 200);
    }
    function __mfValue(prop) {
      var raw;
      try { raw = prop.getValue(); } catch (eValue) { return null; }
      if (typeof raw === "number") return isFinite(raw) ? raw : null;
      if (typeof raw === "boolean") return raw;
      if (raw && typeof raw === "object" && typeof raw.length === "number" && raw.length <= 4) {
        var out = [];
        for (var q = 0; q < raw.length; q++) {
          if (typeof raw[q] !== "number" || !isFinite(raw[q])) return __mfClean(raw);
          out.push(raw[q]);
        }
        return out;
      }
      if (raw === null || raw === undefined) return null;
      return __mfClean(raw);
    }
    function __mfProps(component) {
      var props = [];
      for (var p = 0; p < component.properties.numItems && p < 64; p++) {
        var prop = component.properties[p];
        var entry = { name: __mfClean(prop.displayName), value: __mfValue(prop) };
        try { entry.timeVarying = prop.isTimeVarying() ? true : false; } catch (eTv) {}
        props.push(entry);
      }
      return props;
    }
    function __mfNames(clip) {
      var names = [];
      for (var n = 0; n < clip.components.numItems && n < 64; n++) names.push(__mfClean(clip.components[n].displayName));
      return names;
    }

    var seq = app.project.activeSequence;
    if (!seq) return __error("No active sequence");
    var found = __findClip("${nodeId}");
    if (!found) return __error("Clip not found: ${nodeId}");
    if (found.trackType !== "video") return __error("compute_mask_fit_motion needs a video clip.");
    var clip = found.clip;

    var out = {
      clip: { name: __mfClean(clip.name), nodeId: __mfClean(clip.nodeId), trackIndex: found.trackIndex },
      sequence: { width: Number(seq.frameSizeHorizontal), height: Number(seq.frameSizeVertical) },
      source: { name: null, width: null, height: null, pixelAspectRatio: null, sizeSource: null },
      motion: { found: false, properties: [] },
      mask: { found: false, properties: [] },
      components: __mfNames(clip)
    };

    var item = clip.projectItem;
    if (item) {
      out.source.name = __mfClean(item.name);
      try {
        var interp = item.getFootageInterpretation();
        if (interp && isFinite(interp.pixelAspectRatio) && interp.pixelAspectRatio > 0) out.source.pixelAspectRatio = Number(interp.pixelAspectRatio);
      } catch (eInterp) {}
      var projectMeta = "";
      try { projectMeta = String(item.getProjectMetadata() || ""); } catch (eMeta) {}
      var videoInfo = projectMeta.match(/VideoInfo>\\s*(\\d+)\\s*x\\s*(\\d+)/);
      if (videoInfo) {
        out.source.width = Number(videoInfo[1]);
        out.source.height = Number(videoInfo[2]);
        out.source.sizeSource = "project_metadata_video_info";
      } else {
        var xmp = "";
        try { xmp = String(item.getXMPMetadata() || ""); } catch (eXmp) {}
        var xw = xmp.match(/(?:exif:PixelXDimension|tiff:ImageWidth)[^0-9]{1,40}(\\d+)/);
        var xh = xmp.match(/(?:exif:PixelYDimension|tiff:ImageLength)[^0-9]{1,40}(\\d+)/);
        if (xw && xh) {
          out.source.width = Number(xw[1]);
          out.source.height = Number(xh[1]);
          out.source.sizeSource = "xmp_image_dimensions";
        }
      }
    }

    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      if (comp.displayName === "Motion" || comp.matchName === "AE.ADBE Motion") {
        out.motion.found = true;
        out.motion.properties = __mfProps(comp);
        break;
      }
    }

    if (${readMask}) {
      var maskClip = clip;
      if ("${maskNodeId}" !== "${nodeId}") {
        var maskFound = __findClip("${maskNodeId}");
        if (!maskFound) return __error("Mask clip not found: ${maskNodeId}");
        maskClip = maskFound.clip;
      }
      out.mask.clipName = __mfClean(maskClip.name);
      for (var m = 0; m < maskClip.components.numItems; m++) {
        var candidate = maskClip.components[m];
        if (String(candidate.displayName).toLowerCase() === "${effect}" || String(candidate.matchName).toLowerCase() === "${effect}") {
          out.mask.found = true;
          out.mask.componentName = __mfClean(candidate.displayName);
          out.mask.matchName = __mfClean(candidate.matchName);
          out.mask.properties = __mfProps(candidate);
          break;
        }
      }
      out.maskClipComponents = __mfNames(maskClip);
    }
    return __result(out);
  `);
}

function fail(error: string): CommandResult {
  return { success: false, error };
}

export function getMaskFitTools(bridgeOptions: BridgeOptions) {
  return {
    compute_mask_fit_motion: {
      description:
        "Inspect only. Compute the Motion Scale (%) and Position that place a still image's subject inside an existing Rounded Crop, Crop, or similar mask effect. Reads the sequence frame size, the source frame size, current Motion values, and the mask effect's parameters, then solves the geometry deterministically from a caller-supplied subject box (fractions of the source image, for example head-top to chin). No image analysis and no changes to Premiere. Apply the result with set_clip_scale and set_clip_position (or set_effect_property), then verify with capture_frame. Assumes Rotation 0 and uniform scale; mask geometry is treated as fixed in the sequence frame (mask_space 'sequence').",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", minLength: 1, maxLength: MAX_NODE_ID_LENGTH, description: "Node ID of the video clip that holds the still image and its Motion effect." },
          subject: boxParameter("Subject box in the SOURCE image as fractions of the source frame (0..1), for example top = head-top and bottom = chin or collar."),
          mask_effect: { type: "string", minLength: 1, maxLength: MAX_EFFECT_NAME_LENGTH, description: "Display name or match name of the mask effect (case-insensitive). Defaults to 'Rounded Crop'. Built-in 'Crop' Left/Top/Right/Bottom percentages are supported too." },
          mask_node_id: { type: "string", minLength: 1, maxLength: MAX_NODE_ID_LENGTH, description: "Node ID of the clip that carries the mask effect when it is not the image clip, for example an adjustment layer or nest above it. Defaults to node_id." },
          mask_space: { type: "string", enum: ["sequence", "clip"], description: "Where the mask geometry lives. 'sequence' (default): the mask stays fixed in the sequence frame while Motion moves the image (mask on an adjustment layer or nest, or an effect that renders after Motion). 'clip': the mask moves with the clip's Motion, so Motion cannot reframe the subject inside it and the tool returns an error explaining that." },
          mask_override: boxParameter("Mask bounding box as fractions of the SEQUENCE frame. Skips reading mask parameters; use it when the effect's parameters cannot be interpreted.", true),
          placement: {
            type: "object",
            additionalProperties: false,
            description: "Where the subject should sit inside the mask, as fractions of the mask's bounding box. Defaults: top 0.15, bottom 0.85, center_x 0.5 (height fit); left 0.15, right 0.85, center_y 0.5 (width fit).",
            properties: {
              top: { type: "number", minimum: -1, maximum: 2, description: "Subject top edge as a fraction of the mask height (height fit)." },
              bottom: { type: "number", minimum: -1, maximum: 2, description: "Subject bottom edge as a fraction of the mask height (height fit)." },
              center_x: { type: "number", minimum: -1, maximum: 2, description: "Subject horizontal center as a fraction of the mask width (height fit)." },
              left: { type: "number", minimum: -1, maximum: 2, description: "Subject left edge as a fraction of the mask width (width fit)." },
              right: { type: "number", minimum: -1, maximum: 2, description: "Subject right edge as a fraction of the mask width (width fit)." },
              center_y: { type: "number", minimum: -1, maximum: 2, description: "Subject vertical center as a fraction of the mask height (width fit)." },
            },
          },
          fit_axis: { type: "string", enum: ["height", "width"], description: "Fit the subject's height to placement top/bottom (default) or its width to placement left/right." },
          source_width: { type: "integer", minimum: 1, maximum: MAX_FRAME_DIMENSION, description: "Source image width in pixels. Overrides the value read from project metadata; required with source_height when Premiere does not report it." },
          source_height: { type: "integer", minimum: 1, maximum: MAX_FRAME_DIMENSION, description: "Source image height in pixels. Overrides the value read from project metadata." },
          source_prescale: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Extra scale Premiere applies before Motion, for example when Scale to Frame Size is on (sequence height / source height for a letterboxed fit). Defaults to 1." },
        },
        required: ["node_id", "subject"],
      },
      handler: async (args: ComputeMaskFitArgs): Promise<CommandResult> => {
        if (!args || typeof args.node_id !== "string" || args.node_id.length === 0) return fail("node_id is required.");
        if (!args.subject) return fail("subject is required.");
        try {
          validateNormalizedBox(args.subject, "subject");
          if (args.mask_override) validateNormalizedBox(args.mask_override, "mask_override", true);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        if ((args.source_width === undefined) !== (args.source_height === undefined)) {
          return fail("Pass source_width and source_height together.");
        }
        const maskSpace = args.mask_space ?? "sequence";
        if (maskSpace === "clip") {
          return fail(
            "mask_space 'clip' means the mask moves with the clip's Motion, so changing Motion Scale/Position cannot change which part of the subject the mask shows. Move the mask to an adjustment layer or nest above the image (then pass mask_node_id), or change the mask's own parameters. No Premiere state was read or changed.",
          );
        }
        const maskEffect = (args.mask_effect ?? "Rounded Crop").trim();
        if (maskEffect.length === 0) return fail("mask_effect must not be empty.");

        const readback = await sendCommand(buildReadScript(args, maskEffect), bridgeOptions);
        if (!readback.success) return readback;
        const host = (readback.data ?? {}) as HostReadback;

        const seqW = asNumber(host.sequence?.width);
        const seqH = asNumber(host.sequence?.height);
        if (!seqW || !seqH || seqW <= 0 || seqH <= 0) return fail("Premiere did not report the active sequence frame size.");
        const sequence = { width: seqW, height: seqH };

        const sourceW = args.source_width ?? asNumber(host.source?.width);
        const sourceH = args.source_height ?? asNumber(host.source?.height);
        if (!sourceW || !sourceH) {
          return fail(
            "Could not read the source image's pixel size from project metadata or XMP. Pass source_width and source_height. No Premiere state was changed.",
          );
        }
        const par = asNumber(host.source?.pixelAspectRatio) ?? 1;

        let maskBox: NormalizedBox;
        let interpretation: MaskInterpretation | { method: "override"; used_properties: string[]; assumptions: string[] };
        if (args.mask_override) {
          maskBox = args.mask_override;
          interpretation = { method: "override", used_properties: [], assumptions: ["Mask box supplied by the caller in sequence-frame fractions."] };
        } else {
          if (!host.mask?.found) {
            const names = (host.maskClipComponents ?? host.components ?? []).join(", ") || "none";
            return fail(`Mask effect '${maskEffect}' was not found on the mask clip. Components found: ${names}. Pass mask_effect with one of these names, or mask_override.`);
          }
          const properties: RawEffectProperty[] = (host.mask.properties ?? []).map((prop) => ({ name: String(prop.name), value: prop.value }));
          const interpreted = interpretMaskProperties(properties, sequence);
          if (!interpreted) {
            const listed = properties.map((prop) => `${prop.name}=${JSON.stringify(prop.value)}`).join("; ") || "none";
            return fail(
              `Could not interpret the '${host.mask.componentName ?? maskEffect}' parameters as a mask region. Expected Left/Top/Right/Bottom percentages or a Center with Width/Height, Size, or Radius. Properties found: ${listed}. Pass mask_override with the mask box in sequence-frame fractions.`,
            );
          }
          maskBox = interpreted.box;
          interpretation = interpreted;
        }

        const motionProps = host.motion?.properties ?? [];
        const warnings: string[] = [];
        if (!host.motion?.found) warnings.push("The Motion effect was not found on the clip; current Motion values were not read.");
        const positionRaw = asPoint(findHostProperty(motionProps, "Position")?.value);
        const anchorRaw = asPoint(findHostProperty(motionProps, "Anchor Point")?.value);
        const scaleRaw = asNumber(findHostProperty(motionProps, "Scale")?.value);
        const rotation = asNumber(findHostProperty(motionProps, "Rotation")?.value);
        const uniform = findHostProperty(motionProps, "Uniform Scale")?.value;
        if (rotation !== undefined && Math.abs(rotation) > 1e-6) warnings.push(`Motion Rotation is ${rotation}; the fit assumes Rotation 0.`);
        if (uniform === false) warnings.push("Uniform Scale is off; apply the computed Scale to both Scale Height and Scale Width.");
        const animated = motionProps.filter((prop) => prop.timeVarying).map((prop) => prop.name);
        if (animated.length > 0) warnings.push(`Motion properties are keyframed (${animated.join(", ")}); the result is a static value.`);
        if (host.mask?.properties?.some((prop) => prop.timeVarying)) warnings.push("Mask parameters are keyframed; the fit uses their value at the playhead.");
        const zoom = host.mask?.properties?.find((prop) => prop.name.toLowerCase() === "zoom");
        if (zoom && (zoom.value === true || zoom.value === 1)) warnings.push("The mask effect's Zoom option is on, which rescales the cropped region; the fit ignores that.");
        if (!args.mask_override && (args.mask_node_id === undefined || args.mask_node_id === args.node_id)) {
          warnings.push(
            "The mask effect is on the same clip as the image. Standard effects usually render before Motion and move with it; if capture_frame shows the mask moving with the image, move the mask to an adjustment layer or nest and pass mask_node_id.",
          );
        }

        const positionUnits: "normalized" | "pixels" | "unknown" = positionRaw
          ? looksNormalizedPoint(positionRaw) && Math.max(seqW, seqH) > 4 ? "normalized" : "pixels"
          : "unknown";
        let anchor = { x: 0.5, y: 0.5 };
        if (anchorRaw) {
          anchor = looksNormalizedPoint(anchorRaw)
            ? { x: anchorRaw[0], y: anchorRaw[1] }
            : { x: anchorRaw[0] / sourceW, y: anchorRaw[1] / sourceH };
        }

        let fit;
        try {
          fit = computeMaskFitMotion({
            sequence,
            source: { width: sourceW, height: sourceH, pixelAspectRatio: par },
            mask: maskBox,
            subject: args.subject,
            placement: args.placement,
            fitAxis: args.fit_axis,
            anchor,
            sourcePrescale: args.source_prescale,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }

        const applyPosition = positionUnits === "pixels" ? fit.position_pixels : fit.position_normalized;
        return {
          success: true,
          data: {
            committed: false,
            inspectOnly: true,
            clip: host.clip ?? null,
            scale_percent: fit.scale_percent,
            position: {
              pixels: fit.position_pixels,
              normalized: fit.position_normalized,
              host_units: positionUnits,
              apply_value: positionUnits === "unknown" ? null : applyPosition,
            },
            fit: {
              axis: fit.fit_axis,
              placement: fit.placement,
              mask_pixels: fit.mask_pixels,
              subject_pixels: fit.subject_pixels,
              image_pixels: fit.image_pixels,
            },
            inputs: {
              sequence,
              source: {
                name: host.source?.name ?? null,
                width: sourceW,
                height: sourceH,
                pixelAspectRatio: par,
                sizeSource: args.source_width !== undefined ? "caller" : host.source?.sizeSource ?? null,
                prescale: args.source_prescale ?? 1,
              },
              subject: args.subject,
              mask: {
                effect: args.mask_override ? null : host.mask?.componentName ?? maskEffect,
                matchName: args.mask_override ? null : host.mask?.matchName ?? null,
                clip: args.mask_override ? null : host.mask?.clipName ?? null,
                box: maskBox,
                interpretation,
                properties: args.mask_override ? [] : host.mask?.properties ?? [],
              },
              motion: {
                position: positionRaw ?? null,
                scale: scaleRaw ?? null,
                anchor_point: anchorRaw ?? null,
                anchor_fraction: anchor,
                rotation: rotation ?? null,
                properties: motionProps,
              },
            },
            warnings: [...fit.warnings, ...warnings],
            next_steps: [
              `set_clip_scale { node_id, scale: ${fit.scale_percent} }`,
              positionUnits === "unknown"
                ? "set_clip_position with position.normalized if the host reports Motion Position as 0..1 fractions, otherwise position.pixels"
                : `set_clip_position { node_id, x: ${applyPosition.x}, y: ${applyPosition.y} } (Premiere reported Motion Position in ${positionUnits} units)`,
              "capture_frame to verify the framing inside the mask",
            ],
          },
        };
      },
    },
  };
}
