import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

const LUMETRI_SECTION_HEADER_NAMES = [
  "Basic Correction",
  "Creative",
  "Curves",
  "Color Wheels & Match",
  "HSL Secondary",
  "Vignette",
];

/** Shared ES3 readback for the two QE effect-add paths. */
function applyEffectWithReadback(kind: "Video" | "Audio"): string {
  return `
    var before = [];
    function readComponents() {
      var components = result.clip.components;
      var count = components && components.numItems;
      if (typeof count !== "number" || !isFinite(count) || count < 0 || Math.floor(count) !== count) {
        throw new Error("Component count is unavailable");
      }
      var snapshot = [];
      for (var c = 0; c < count; c++) {
        snapshot.push({ displayName: String(components[c].displayName || ""), matchName: String(components[c].matchName || "") });
      }
      return snapshot;
    }
    try { before = readComponents(); }
    catch (beforeError) { return __error("Cannot read components before adding the effect; nothing was changed."); }
    var addError = "";
    try { qeClip.add${kind}Effect(qeEffect); }
    catch (effectError) { addError = String(effectError); }
    var after = null;
    var added = [];
    try {
      after = readComponents();
      var matched = [];
      for (var a = 0; a < after.length; a++) {
        var found = false;
        for (var b = 0; b < before.length; b++) {
          if (!matched[b] && before[b].displayName === after[a].displayName && before[b].matchName === after[a].matchName) {
            matched[b] = true;
            found = true;
            break;
          }
        }
        if (!found) added.push(after[a]);
      }
    } catch (readError) { after = null; }
    var data = {
      effect: effectName, lookupSource: lookupSource, clipName: result.clip.name,
      componentCountBefore: before.length, componentCountAfter: after ? after.length : null,
      addedComponents: added, verified: false, outcome: "committed_unverified",
      renderVerified: false, verificationScope: "Component-list readback only; verify live playback or rendered output before delivery."
    };
    if (after && after.length > before.length && added.length > 0) {
      data.timelineChanged = true;
      if (!addError) {
        data.applied = true;
        data.verified = true;
        data.outcome = "verified";
        return __result(data);
      }
    }
    var undoNow = typeof __readUndoIndex === "function" && __undoStart !== null ? __readUndoIndex() : null;
    if (__undoStart !== null && undoNow !== null && undoNow === __undoStart && after && after.length === before.length && added.length === 0 && !addError) {
      data.outcome = "not_applied";
      return __jsonStringify({ success: false, error: "Premiere added no component for " + effectName + "; nothing was changed.", data: data });
    }
    data.note = "Do not retry blindly: QE may have added the effect even when it is missing from the DOM component list. Inspect the clip before retrying.";
    if (addError) data.hostError = addError;
    if (typeof __readUndoIndex === "function" && __undoStart !== null) {
      if (undoNow !== null && undoNow > __undoStart) {
        data.undoSteps = undoNow - __undoStart;
        data.undoStackIndex = undoNow;
        data.timelineChanged = true;
      }
    }
    return __jsonStringify({ success: false, error: "Effect addition could not be verified. " + data.note, data: data });
  `;
}

export function getEffectsTools(bridgeOptions: BridgeOptions) {
  return {
    apply_effect: {
      description: "Apply a video effect to a clip. Experimental QE DOM catalog lookup includes an exact-name probe when enumeration is empty. A component-list readback does not verify rendered pixels.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to apply the effect to",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect (e.g., 'Gaussian Blur', 'Lumetri Color')",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          // Find the effect in QE
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = result.trackType === "video" 
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          
          if (!qeTrack) return __error("QE track not found");

          // QE track items include gaps, so the DOM clip index is not a QE index.
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("Could not match the QE clip for " + result.clip.name + " by timeline start; nothing was changed.");

          // Premiere 26 can expose direct by-name lookup while returning an
          // empty QE catalog. Probe the requested name before consulting the
          // catalog so a known installed effect remains usable.
          var qeEffect = null;
          try { qeEffect = qe.project.getVideoEffectByName(effectName); } catch (byNameError) {}
          var lookupSource = qeEffect ? "qe.byName" : "qe.catalog";
          if (!qeEffect) {
            var effectCatalog = __getQeEffectCatalog("video");
            if (!effectCatalog.ok) return __error(effectCatalog.error + " Direct QE lookup for \\"" + effectName + "\\" also did not resolve an effect.");
            var effects = effectCatalog.effects;
            for (var i = 0; i < effects.numItems; i++) {
              if (effects[i].name === effectName) {
                qeEffect = __qeEffectObject("video", effects[i]);
                break;
              }
            }
          }
          if (!qeEffect) return __error("Effect not found: " + effectName);
          ${applyEffectWithReadback("Video")}
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_audio_effect: {
      description: "Apply an audio effect to a clip. Experimental QE catalog lookup includes an exact-name probe when enumeration is empty. A component-list readback does not verify rendered audio.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Name of the audio effect",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE audio track not found");

          // QE track items include gaps, so the DOM clip index is not a QE index.
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("Could not match the QE clip for " + result.clip.name + " by timeline start; nothing was changed.");
          
          var qeEffect = null;
          try { qeEffect = qe.project.getAudioEffectByName(effectName); } catch (byNameError) {}
          var lookupSource = qeEffect ? "qe.byName" : "qe.catalog";
          if (!qeEffect) {
            var effectCatalog = __getQeEffectCatalog("audio");
            if (!effectCatalog.ok) return __error(effectCatalog.error + " Direct QE lookup for \\"" + effectName + "\\" also did not resolve an effect.");
            var effects = effectCatalog.effects;
            for (var i = 0; i < effects.numItems; i++) {
              if (effects[i].name === effectName) {
                qeEffect = __qeEffectObject("audio", effects[i]);
                break;
              }
            }
          }
          if (!qeEffect) return __error("Audio effect not found: " + effectName);
          ${applyEffectWithReadback("Audio")}
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect: {
      description: "Remove one effect from a clip by its index or name (the last instance when names repeat) and verify the clip's components afterwards. Built-in components (Opacity, Motion, Volume, Channel Volume, Panner) cannot be removed. EXPERIMENTAL: when Premiere has no Component.remove() (25.2), it removes through the undocumented QE DOM's targeted qeClip.getComponentAt(i).remove(). Every matching component's removal path is checked before any is removed; it returns a capability error, with nothing changed, when neither path is available.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_index: {
            type: "number",
            minimum: 0,
            description: "Index of the effect to remove (0-based). Use get_clip_properties to see effects list.",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect to remove (alternative to effect_index)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; effect_index?: number; effect_name?: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;
          ${args.effect_index !== undefined ? `
          var chosen = ${args.effect_index};
          if (chosen < 0 || chosen >= clip.components.numItems) return __error("Effect index out of range");
          var effectName = String(clip.components[chosen].displayName);
          ` : `
          var effectName = "${escapeForExtendScript(args.effect_name || "")}";
          var chosen = -1;
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (clip.components[i].displayName === effectName) { chosen = i; break; }
          }
          if (chosen < 0) return __error("Effect not found: " + effectName);
          `}
          if (__isBuiltInComponent(clip.components[chosen])) return __error(effectName + " is a built-in clip component, not an effect, and cannot be removed.");
          var removal = __removeClipComponents(result, function (name, index) { return index === chosen; });
          if (removal.unsupported) return __error("Capability error: " + removal.unsupported + " Nothing was removed; remove effects in Effect Controls.");
          if (removal.failures.length && removal.nothingRemoved) return __error("Capability error: Premiere exposes neither Component.remove() nor a matching QE component for " + effectName + ". The effect was not removed; remove it in Effect Controls.");
          if (removal.failures.length) return __error("Premiere could not remove " + effectName + " from this clip; it is still present. Inspect Effect Controls.");
          if (!removal.verified) return __error((removal.remaining.join("|") === removal.before.join("|") ? "Premiere's removal did not take effect: the clip still has " : "Premiere's removal did not take effect as expected: the clip's components read back as ") + removal.remaining.join(", ") + ". Inspect Effect Controls.");
          return __result({ removed: true, verified: true, effect: effectName, remaining: removal.remaining });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_effects: {
      description: "List available video effects in Premiere Pro. Uses the full QE catalog when exposed; otherwise returns a verified, explicitly partial set of common effects resolved by exact name.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var list = [];
          var effectCatalog = __getQeEffectCatalog("video");
          if (effectCatalog.ok) {
            var effects = effectCatalog.effects;
            for (var i = 0; i < effects.numItems; i++) {
              list.push({ name: effects[i].name, index: i, source: "qe.catalog" });
            }
            return __result(list);
          }

          // Keep this bounded and label every result as partial. It is a
          // usability fallback, not a claim that these are all installed
          // effects or that their localized display names are exhaustive.
          var commonNames = ["Transform", "Gaussian Blur", "Lumetri Color", "Crop", "Warp Stabilizer", "Tint", "Brightness & Contrast", "Ultra Key"];
          for (var probeIndex = 0; probeIndex < commonNames.length; probeIndex++) {
            var candidate = null;
            try { candidate = qe.project.getVideoEffectByName(commonNames[probeIndex]); } catch (probeError) {}
            if (candidate) list.push({ name: commonNames[probeIndex], index: null, source: "qe.byName.partial" });
          }
          if (list.length === 0) return __error(effectCatalog.error + " Direct lookup did not resolve any bounded fallback effects.");
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_effects: {
      description: "List all available audio effects in Premiere Pro. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var effectCatalog = __getQeEffectCatalog("audio");
          if (!effectCatalog.ok) return __error(effectCatalog.error);
          var effects = effectCatalog.effects;
          var list = [];
          for (var i = 0; i < effects.numItems; i++) {
            list.push({ name: effects[i].name, index: i });
          }
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    color_correct: {
      description: "Apply basic color correction through experimental QE Lumetri insertion. Requires Lumetri component and requested property readback; rendered output is not verified.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          exposure: { type: "number", description: "Exposure adjustment (-4.0 to 4.0)" },
          contrast: { type: "number", description: "Contrast adjustment (-100 to 100)" },
          highlights: { type: "number", description: "Highlights adjustment (-100 to 100)" },
          shadows: { type: "number", description: "Shadows adjustment (-100 to 100)" },
          whites: { type: "number", description: "Whites adjustment (-100 to 100)" },
          blacks: { type: "number", description: "Blacks adjustment (-100 to 100)" },
          temperature: { type: "number", description: "Color temperature adjustment" },
          tint: { type: "number", description: "Tint adjustment" },
          saturation: { type: "number", description: "Saturation (0-200, 100 = normal)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        exposure?: number;
        contrast?: number;
        highlights?: number;
        shadows?: number;
        whites?: number;
        blacks?: number;
        temperature?: number;
        tint?: number;
        saturation?: number;
      }) => {
        // Resolve color_correct controls only within Lumetri Basic Correction.
        const controls: Array<{ key: string; label: string; value: number }> = (
          [
            { key: "exposure", label: "Exposure", value: args.exposure },
            { key: "contrast", label: "Contrast", value: args.contrast },
            { key: "highlights", label: "Highlights", value: args.highlights },
            { key: "shadows", label: "Shadows", value: args.shadows },
            { key: "whites", label: "Whites", value: args.whites },
            { key: "blacks", label: "Blacks", value: args.blacks },
            { key: "temperature", label: "Temperature", value: args.temperature },
            { key: "tint", label: "Tint", value: args.tint },
            { key: "saturation", label: "Saturation", value: args.saturation },
          ] as Array<{ key: string; label: string; value: number | undefined }>
        ).filter((c): c is { key: string; label: string; value: number } => c.value !== undefined);

        if (!controls.length) return { success: false, error: "Specify at least one color correction value; nothing was changed." };
        if (controls.some((control) => !Number.isFinite(control.value))) return { success: false, error: "Color correction values must be finite numbers; nothing was changed." };

        const setters = controls
          .map(
            (c) => `
              if (!taken.${c.key} && name === "${c.label}") {
                try {
                  writeAttempted = true;
                  prop.setValue(${c.value}, true);
                  var observed = Number(prop.getValue());
                  if (!isFinite(observed) || Math.abs(observed - ${c.value}) > 0.001) {
                    errors.${c.key} = "Premiere did not read back the requested value";
                  } else {
                    taken.${c.key} = true;
                    changes.${c.key} = observed;
                    delete errors.${c.key};
                  }
                } catch(e) {
                  errors.${c.key} = e.toString();
                }
              }`
          )
          .join("");

        // First apply Lumetri Color effect, then set its properties
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          // Apply Lumetri Color if not already present
          var clip = result.clip;
          var hasLumetri = false;
          var lumetri = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") {
              hasLumetri = true;
              lumetri = clip.components[i];
              break;
            }
          }

          var qeAttempted = false;
          var qeAddError = "";
          if (!hasLumetri) {
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            // QE track items include gaps, so the DOM clip index is not a QE index.
            var qeClip = __findQeClipByDomClip(qeTrack, clip);
            if (!qeClip) return __error("Could not match the QE clip for " + clip.name + " by timeline start; nothing was changed.");
            var effectCatalog = __getQeEffectCatalog("video");
            if (!effectCatalog.ok) return __error(effectCatalog.error);
            var effects = effectCatalog.effects;
            var qeEffect = null;
            for (var i = 0; i < effects.numItems; i++) {
              if (effects[i].name === "Lumetri Color") {
                qeEffect = __qeEffectObject("video", effects[i]);
                break;
              }
            }
            if (!qeEffect) return __error("The QE video-effect catalog does not contain Lumetri Color; nothing was changed.");
            qeAttempted = true;
            try { qeClip.addVideoEffect(qeEffect); } catch (eAdd) { qeAddError = String(eAdd); }
            for (var li = 0; li < clip.components.numItems; li++) {
              if (clip.components[li].displayName === "Lumetri Color") { lumetri = clip.components[li]; break; }
            }
            if (!lumetri) {
              return __jsonStringify({ success: false,
                error: "Premiere did not expose a Lumetri Color component after the QE add attempt; color correction was not verified. Inspect the clip before retrying.",
                data: { colorCorrected: false, verified: false, renderVerified: false,
                  timelineChanged: true, outcome: "committed_unverified", hostError: qeAddError } });
            }
          }

          var sectionHeaderNames = ${JSON.stringify(LUMETRI_SECTION_HEADER_NAMES)};
          var basicCorrectionHeaderName = sectionHeaderNames[0];
          var correctionStart = -1;
          var correctionEnd = lumetri.properties.numItems;
          for (var sectionIndex = 0; sectionIndex < lumetri.properties.numItems; sectionIndex++) {
            if (String(lumetri.properties[sectionIndex].displayName) === basicCorrectionHeaderName) { correctionStart = sectionIndex + 1; break; }
          }
          // If Basic Correction is unavailable, retain the prior whole-component
          // lookup and ambiguity refusal instead of guessing a section boundary.
          var controlStart = correctionStart >= 0 ? correctionStart : 0;
          if (correctionStart >= 0) {
            for (var nextHeaderIndex = correctionStart; nextHeaderIndex < lumetri.properties.numItems; nextHeaderIndex++) {
              var nextHeaderName = String(lumetri.properties[nextHeaderIndex].displayName);
              var isSectionHeader = false;
              for (var headerIndex = 0; headerIndex < sectionHeaderNames.length; headerIndex++) {
                if (nextHeaderName === sectionHeaderNames[headerIndex]) { isSectionHeader = true; break; }
              }
              if (isSectionHeader) { correctionEnd = nextHeaderIndex; break; }
            }
          }
          var ambiguousControls = [];
          var missingControls = [];
          for (var controlIndex = 0; controlIndex < ${controls.length}; controlIndex++) {
            var control = [${controls.map((c) => `"${c.label}"`).join(",")}][controlIndex];
            var candidateIndices = [];
            for (var propertyIndex = controlStart; propertyIndex < correctionEnd; propertyIndex++) {
              if (String(lumetri.properties[propertyIndex].displayName) === control) candidateIndices.push(propertyIndex);
            }
            if (candidateIndices.length > 1) ambiguousControls.push(control + " at property indices [" + candidateIndices.join(", ") + "]");
            else if (candidateIndices.length === 0) missingControls.push(control);
          }
          if (ambiguousControls.length || missingControls.length) {
            return __jsonStringify({ success: false,
              error: (ambiguousControls.length ? "Lumetri property names are ambiguous: " + ambiguousControls.join("; ") + ". " : "") +
                (missingControls.length ? "Lumetri Basic Correction properties were not found: " + missingControls.join(", ") + ". " : "") +
                "Use set_effect_property with property_index from get_effect_properties.",
              data: { colorCorrected: false, verified: false, renderVerified: false, timelineChanged: qeAttempted, outcome: qeAttempted ? "committed_unverified" : "not_applied", errors: {}, changes: {} } });
          }

          // A single unsettable property must not abort the script with "Invalid
          // parameter" and lose every other change, so each write is guarded.
          // The taken map is a separate set of flags rather than a truthiness check on
          // changes: 0 is a legitimate value (saturation 0 is a valid full desaturate),
          // and a falsy check would re-fire it on every later sub-section that repeats
          // the same display name.
          var changes = {};
          var errors = {};
          var taken = {};
          var writeAttempted = false;

          try {
            for (var p = controlStart; p < correctionEnd; p++) {
              var prop = lumetri.properties[p];
              var name = prop.displayName;
              ${setters}
            }
          } catch (propertyError) { errors.properties = String(propertyError); }
          var changeCount = 0;
          ${controls.map((control) => `if (!taken.${control.key} && !errors.${control.key}) errors.${control.key} = "Requested Lumetri property was not found or writable";`).join("\n")}
          for (var changedKey in changes) if (changes.hasOwnProperty(changedKey)) changeCount++;
          if (changeCount !== ${controls.length} || qeAddError) {
            var mutationAttempted = qeAttempted || writeAttempted;
            return __jsonStringify({ success: false,
              error: mutationAttempted
                ? "Lumetri Color did not read back every requested value; the timeline may have changed. Inspect the clip before retrying."
                : "No requested Lumetri control was found or writable; nothing was changed.",
              data: { colorCorrected: false, verified: false, renderVerified: false,
                timelineChanged: mutationAttempted, outcome: mutationAttempted ? "committed_unverified" : "not_applied",
                clipName: clip.name, changes: changes, errors: errors, hostError: qeAddError } });
          }
          return __result({ colorCorrected: true, verified: true, renderVerified: false,
            verificationScope: "Lumetri component and property readback only; inspect rendered output before delivery.",
            clipName: clip.name, changes: changes, errors: errors });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_lut: {
      description:
        "Unavailable on the CEP backend: Premiere's scripting API cannot load a LUT file into Lumetri Color. Its Input LUT and Look parameters are menu indexes over a curated set of bundled looks, and writing a file path to the LUT asset parameters is accepted but not rendered (seen on Premiere Pro 25.2.3, macOS, by comparing exported frames with the same LUT applied by ffmpeg; other builds were not tested). Fails before changing the clip. Apply the LUT in Lumetri Color > Creative > Look (Browse...) instead.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          lut_path: {
            type: "string",
            description: "Full path to the .cube or .3dl LUT file",
          },
        },
        required: ["node_id", "lut_path"],
      },
      handler: async (args: { node_id: string; lut_path: string }) => {
        void args;
        return {
          success: false,
          error:
            "Premiere's scripting API cannot apply a LUT file: Lumetri's Input LUT and Look are menu indexes, and a file path written to the LUT asset parameters is accepted but not rendered (seen on Premiere Pro 25.2.3, macOS; other builds were not tested). Nothing was changed. Apply the LUT in Lumetri Color > Creative > Look > Browse..., or use color_correct for exposure, contrast, temperature, tint, and saturation.",
        };
      },
    },

    inspect_stabilizer_status: {
      description: "Read Warp Stabilizer presence, exposed status properties, and conservative analysis state for one clip or every video clip in the active sequence. Read-only: unknown or localized host values remain unknown rather than being reported as solved.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          node_id: { type: "string", description: "Optional clip node ID. Omit to inspect every video clip in the active sequence." },
        },
      },
      handler: async (args: { node_id?: string }) => {
        const nodeId = args.node_id ? escapeForExtendScript(args.node_id) : "";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var requestedNodeId = "${nodeId}";
          var clips = [];
          if (requestedNodeId) {
            var found = __findClip(requestedNodeId);
            if (!found || found.trackType !== "video") return __error("Video clip not found: " + requestedNodeId);
            clips.push({ clip: found.clip, trackIndex: found.trackIndex, clipIndex: found.clipIndex });
          } else {
            for (var trackIndex = 0; trackIndex < seq.videoTracks.numTracks; trackIndex++) {
              var track = seq.videoTracks[trackIndex];
              for (var clipIndex = 0; clipIndex < track.clips.numItems; clipIndex++) {
                clips.push({ clip: track.clips[clipIndex], trackIndex: trackIndex, clipIndex: clipIndex });
              }
            }
          }
          function primitiveValue(value) {
            if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
            return String(value);
          }
          var results = [];
          for (var clipCursor = 0; clipCursor < clips.length; clipCursor++) {
            var entry = clips[clipCursor];
            var stabilizer = null;
            for (var componentIndex = 0; componentIndex < entry.clip.components.numItems; componentIndex++) {
              var component = entry.clip.components[componentIndex];
              var componentName = String(component.displayName || "");
              var matchName = String(component.matchName || "");
              var identity = (componentName + " " + matchName).toLowerCase();
              if (identity.indexOf("warp stabilizer") >= 0 || identity.indexOf("warp stabiliser") >= 0) {
                stabilizer = component;
                break;
              }
            }
            if (!stabilizer) continue;
            var properties = [];
            var stateEvidence = [];
            for (var propertyIndex = 0; propertyIndex < stabilizer.properties.numItems; propertyIndex++) {
              var property = stabilizer.properties[propertyIndex];
              var propertyName = String(property.displayName || "");
              var propertyValue = null;
              var readable = true;
              try { propertyValue = primitiveValue(property.getValue()); } catch (readError) { readable = false; }
              properties.push({ name: propertyName, value: propertyValue, readable: readable });
              var stateName = propertyName.toLowerCase();
              if (stateName.indexOf("status") >= 0 || stateName.indexOf("result") >= 0 || stateName.indexOf("analy") >= 0) {
                stateEvidence.push({ name: propertyName, value: propertyValue, readable: readable });
              }
            }
            var analysisStatus = "unknown";
            for (var evidenceIndex = 0; evidenceIndex < stateEvidence.length; evidenceIndex++) {
              var text = String(stateEvidence[evidenceIndex].value).toLowerCase();
              if (text.indexOf("not analy") >= 0 || text.indexOf("unanaly") >= 0) analysisStatus = "not_analyzed";
              else if (text.indexOf("analyzing") >= 0 || text.indexOf("analysing") >= 0 || text.indexOf("progress") >= 0) analysisStatus = "analyzing";
              else if (text.indexOf("stabilized") >= 0 || text.indexOf("stabilised") >= 0 || text.indexOf("complete") >= 0 || text.indexOf("solved") >= 0) analysisStatus = "analyzed";
            }
            results.push({
              nodeId: String(entry.clip.nodeId), clipName: String(entry.clip.name),
              trackIndex: entry.trackIndex, clipIndex: entry.clipIndex,
              componentName: String(stabilizer.displayName || "Warp Stabilizer"),
              analysisStatus: analysisStatus, stateEvidence: stateEvidence, properties: properties
            });
          }
          return __result({
            inspectedClipCount: clips.length,
            stabilizerClipCount: results.length,
            clips: results,
            verificationScope: "Read-only host property inspection. analysisStatus is conservative and remains unknown when Premiere exposes numeric, localized, absent, or unreadable state values; unknown is not proof of a completed solve."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stabilize_clip: {
      description: "Apply Warp Stabilizer using the experimental QE DOM. Verifies component addition and readable parameter values, never analysis completion. Numeric or unreadable Method popup values remain unverified because no documented label mapping is available.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to stabilize",
          },
          smoothness: {
            type: "number",
            description: "Stabilization smoothness percentage (default: 50). Higher = smoother but more cropping.",
          },
          method: {
            type: "string",
            enum: ["Subspace Warp", "Position", "Position, Scale, Rotation"],
            description: "Stabilization method (default: 'Subspace Warp')",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; smoothness?: number; method?: string }) => {
        if (args.smoothness !== undefined && (!Number.isFinite(args.smoothness) || args.smoothness < 0 || args.smoothness > 100)) return { success: false, error: "smoothness must be a finite percentage from 0 to 100" };
        if (args.method !== undefined && !["Subspace Warp", "Position", "Position, Scale, Rotation"].includes(args.method)) return { success: false, error: "Unsupported stabilization method" };
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : null;
          if (!qeTrack) return __error("Warp Stabilizer can only be applied to video clips");
          
          // QE track items include gaps, so the DOM clip index is not a QE index.
          var qeClip = __findQeClipByDomClip(qeTrack, result.clip);
          if (!qeClip) return __error("Could not match the QE clip for " + result.clip.name + " by timeline start; nothing was changed.");

          var componentCountBefore = result.clip.components.numItems;
          if (typeof componentCountBefore !== "number" || !isFinite(componentCountBefore)) return __error("Cannot read clip components; nothing was changed.");
          // Find and apply Warp Stabilizer
          var effectCatalog = __getQeEffectCatalog("video");
          if (!effectCatalog.ok) return __error(effectCatalog.error);
          var effects = effectCatalog.effects;
          var found = false;
          for (var i = 0; i < effects.numItems; i++) {
            if (effects[i].name === "Warp Stabilizer") {
              qeClip.addVideoEffect(__qeEffectObject("video", effects[i]));
              found = true;
              break;
            }
          }
          
          if (!found) return __error("Warp Stabilizer effect not found");
          
          var clip = result.clip;
          var afterCount = null;
          var stabilizer = null;
          try {
            afterCount = clip.components.numItems;
            if (typeof afterCount !== "number" || !isFinite(afterCount)) afterCount = null;
            if (afterCount !== null) {
              for (var componentIndex = componentCountBefore; componentIndex < afterCount; componentIndex++) {
                if (clip.components[componentIndex].displayName === "Warp Stabilizer") stabilizer = clip.components[componentIndex];
              }
            }
          } catch (componentReadError) { afterCount = null; }
          var changes = { stabilized: false };
          var data = { clipName: clip.name, changes: changes, requested: { smoothness: ${args.smoothness === undefined ? "null" : args.smoothness}, method: ${args.method === undefined ? "null" : `"${escapeForExtendScript(args.method)}"`} }, applied: { smoothness: null, method: null }, componentCountBefore: componentCountBefore, componentCountAfter: afterCount, verified: false, outcome: "committed_unverified", analysisStatus: "unknown", info: "Effect and parameter readback only; analysis completion and rendered stabilization require separate inspection." };
          if (afterCount !== null && afterCount <= componentCountBefore) { data.outcome = "failed"; return __error("Premiere did not add Warp Stabilizer.", data); }
          if (!stabilizer) return __result(data);
          changes.stabilized = true;
          var parameterVerified = true;
          var parameterMismatch = false;
          var warnings = [];
          function setStabilizerParameter(name, requested, field) {
            if (requested === null) return;
            var property = null;
            var matches = 0;
            for (var propertyIndex = 0; propertyIndex < stabilizer.properties.numItems; propertyIndex++) {
              if (stabilizer.properties[propertyIndex].displayName === name) { property = stabilizer.properties[propertyIndex]; matches++; }
            }
            if (matches !== 1) { parameterVerified = false; warnings.push(name + " property is unavailable or ambiguous."); return; }
            try {
              if (name === "Method") {
                var currentMethod = property.getValue();
                if (typeof currentMethod !== "string" || (currentMethod !== "Subspace Warp" && currentMethod !== "Position" && currentMethod !== "Position, Scale, Rotation")) {
                  parameterVerified = false;
                  warnings.push("Method popup mapping is unavailable; method was not changed.");
                  return;
                }
              }
              property.setValue(requested, true);
              var actual = property.getValue();
              if (actual === undefined || actual === null || (typeof actual === "number" && !isFinite(actual))) { parameterVerified = false; return; }
              data.applied[field] = actual;
              changes[field] = actual;
              var same = typeof actual === "number" && typeof requested === "number" ? Math.abs(actual - requested) <= 0.0001 : actual === requested;
              if (!same) { parameterMismatch = true; parameterVerified = false; }
            } catch (parameterError) { parameterVerified = false; warnings.push(name + " write or readback unavailable: " + String(parameterError)); }
          }
          setStabilizerParameter("Smoothness", data.requested.smoothness, "smoothness");
          setStabilizerParameter("Method", data.requested.method, "method");
          data.warnings = warnings;
          data.verified = parameterVerified;
          data.outcome = parameterMismatch ? "failed" : (parameterVerified ? "verified" : "committed_unverified");
          if (parameterMismatch) return __error("Warp Stabilizer parameter readback does not match the requested value.", data);
          return __result(data);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
