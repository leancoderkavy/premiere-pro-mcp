import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getClipboardTools(bridgeOptions: BridgeOptions) {
  return {
    copy_effects_between_clips: {
      description: "Copy all effects (or a specific effect) from one clip to another. Does not copy intrinsic properties like Motion/Opacity unless specified.",
      parameters: {
        type: "object" as const,
        properties: {
          source_node_id: {
            type: "string",
            description: "Node ID of the source clip to copy effects from",
          },
          target_node_id: {
            type: "string",
            description: "Node ID of the target clip to paste effects to",
          },
          effect_name: {
            type: "string",
            description: "Specific effect display name to copy (copies all non-intrinsic effects if omitted)",
          },
        },
        required: ["source_node_id", "target_node_id"],
      },
      handler: async (args: { source_node_id: string; target_node_id: string; effect_name?: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var srcResult = __findClip("${escapeForExtendScript(args.source_node_id)}");
          if (!srcResult) return __error("Source clip not found");
          var tgtResult = __findClip("${escapeForExtendScript(args.target_node_id)}");
          if (!tgtResult) return __error("Target clip not found");

          var src = srcResult.clip;
          var tgt = tgtResult.clip;
          var copied = 0;
          var effectFilter = ${args.effect_name ? `"${escapeForExtendScript(args.effect_name)}"` : "null"};
          var intrinsic = ["Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner"];

          // Use QE to copy effects by name
          var qeSeq = qe.project.getActiveSequence();
          var tgtTrackType = tgtResult.trackType;
          var tgtTrack = tgtTrackType === "video" 
            ? qeSeq.getVideoTrackAt(tgtResult.trackIndex) 
            : qeSeq.getAudioTrackAt(tgtResult.trackIndex);
          var qeTgtClip = tgtTrack.getItemAt(tgtResult.clipIndex);

          for (var i = 0; i < src.components.numItems; i++) {
            var comp = src.components[i];
            var name = comp.displayName;

            if (effectFilter && name !== effectFilter) continue;
            if (!effectFilter) {
              var skip = false;
              for (var k = 0; k < intrinsic.length; k++) {
                if (name === intrinsic[k]) { skip = true; break; }
              }
              if (skip) continue;
            }

            // Apply effect via QE
            try {
              var qeEffect = tgtTrackType === "video"
                ? qe.project.getVideoEffectByName(name)
                : qe.project.getAudioEffectByName(name);
              if (qeEffect) {
                if (tgtTrackType === "video") {
                  qeTgtClip.addVideoEffect(qeEffect);
                } else {
                  qeTgtClip.addAudioEffect(qeEffect);
                }
                copied++;
              }
            } catch(e) {}
          }

          return __result({ copiedEffects: copied, source: src.name, target: tgt.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    copy_effect_values: {
      description:
        "Copy verified scalar effect-property values from one effect to the matching effect on another clip. Both clips must already have the same effect applied. Legacy CEP deliberately refuses Blend Mode because Premiere can corrupt its enum value on cross-clip writes.",
      parameters: {
        type: "object" as const,
        properties: {
          source_node_id: {
            type: "string",
            description: "Node ID of the source clip",
          },
          target_node_id: {
            type: "string",
            description: "Node ID of the target clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect to copy values for",
          },
        },
        required: ["source_node_id", "target_node_id", "effect_name"],
      },
      handler: async (args: { source_node_id: string; target_node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          var srcResult = __findClip("${escapeForExtendScript(args.source_node_id)}");
          if (!srcResult) return __error("Source clip not found");
          var tgtResult = __findClip("${escapeForExtendScript(args.target_node_id)}");
          if (!tgtResult) return __error("Target clip not found");

          var srcComp = null;
          var tgtComp = null;
          for (var i = 0; i < srcResult.clip.components.numItems; i++) {
            if (srcResult.clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}") {
              srcComp = srcResult.clip.components[i];
              break;
            }
          }
          if (!srcComp) return __error("Effect not found on source clip: ${escapeForExtendScript(args.effect_name)}");

          for (var i = 0; i < tgtResult.clip.components.numItems; i++) {
            if (tgtResult.clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}") {
              tgtComp = tgtResult.clip.components[i];
              break;
            }
          }
          if (!tgtComp) return __error("Effect not found on target clip: ${escapeForExtendScript(args.effect_name)}");

          function valuesMatch(left, right) {
            if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) < 0.000001;
            return String(left) === String(right);
          }
          var copied = 0;
          var skipped = [];
          var failures = [];
          for (var p = 0; p < srcComp.properties.numItems; p++) {
            var srcProp = srcComp.properties[p];
            for (var q = 0; q < tgtComp.properties.numItems; q++) {
              if (tgtComp.properties[q].displayName === srcProp.displayName) {
                if (srcProp.displayName === "Blend Mode") {
                  skipped.push({ property: srcProp.displayName, reason: "Legacy CEP enum writes can corrupt Blend Mode; no write was attempted." });
                  break;
                }
                try {
                  var val = srcProp.getValue(0, 0);
                  tgtComp.properties[q].setValue(val, true);
                  var readback = tgtComp.properties[q].getValue(0, 0);
                  if (!valuesMatch(readback, val)) {
                    failures.push(srcProp.displayName + " did not match its source value after the write");
                  } else {
                    copied++;
                  }
                } catch(e) {
                  failures.push(srcProp.displayName + " could not be copied and read back: " + e.toString());
                }
                break;
              }
            }
          }

          if (skipped.length || failures.length) {
            return __error(
              "Effect-value copy was not fully verified. Copied " + copied + " property value(s); " +
              "skipped: " + skipped.length + "; failures: " + failures.length + ". " +
              "Blend Mode is intentionally refused on legacy CEP because Premiere can write an unrelated enum value. Inspect Effect Controls before retrying."
            );
          }
          return __result({ copiedProperties: copied, verified: true, effect: "${escapeForExtendScript(args.effect_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    replace_clip_media: {
      description: "Unavailable by design: the legacy ExtendScript overwrite route cannot prove that replacing media preserves the original clip's trim, position, linked audio, or adjacent clips, so this tool performs no mutation.",
      parameters: {
        type: "object" as const,
        properties: {
          clip_node_id: {
            type: "string",
            description: "Node ID of the timeline clip to replace media on",
          },
          new_item_id: {
            type: "string",
            description: "Node ID or name of the new source project item",
          },
        },
        required: ["clip_node_id", "new_item_id"],
      },
      handler: async () => ({
        success: false,
        error: "replace_clip_media is unavailable because the legacy overwrite route cannot preserve and verify clip duration, placement, linked audio, and neighboring clips. No mutation was attempted.",
      }),
    },

    batch_apply_effect: {
      description: "Apply one audio or video effect to compatible selected clips, a compatible track, or all compatible clips. Every target is preflighted and then checked by component-count readback.",
      parameters: {
        type: "object" as const,
        properties: {
          effect_name: {
            type: "string",
            description: "Display name of the effect to apply (e.g., 'Gaussian Blur', 'Lumetri Color')",
          },
          target: {
            type: "string",
            enum: ["selected", "track", "all"],
            description: "Which clips to apply to: selected clips, all on a track, or all in sequence",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (required when target is 'track')",
          },
          track_index: {
            type: "number",
            description: "Track index (required when target is 'track')",
          },
      },
      required: ["effect_name", "target"],
      },
      handler: async (args: { effect_name: string; target: string; track_type?: string; track_index?: number }) => {
        if (!args.effect_name.trim()) return { success: false, error: "effect_name must not be empty" };
        if (args.target !== "selected" && args.target !== "track" && args.target !== "all") {
          return { success: false, error: "target must be selected, track, or all" };
        }
        if (args.target === "track" && (args.track_type !== "video" && args.track_type !== "audio")) {
          return { success: false, error: "track_type must be video or audio when target is track" };
        }
        if (args.target === "track" && (!Number.isInteger(args.track_index) || (args.track_index as number) < 0)) {
          return { success: false, error: "track_index must be a non-negative integer when target is track" };
        }
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");

          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeEffect = qe.project.getVideoEffectByName(effectName);
          var effectType = "video";
          if (!qeEffect) {
            qeEffect = qe.project.getAudioEffectByName(effectName);
            effectType = "audio";
          }
          if (!qeEffect) return __error("Effect not found: " + effectName);

          var target = "${args.target}";
          var targets = [];
          var selectedIncompatible = 0;

          function collectTracks(tracks, trackType, selectedOnly, onlyTrackIndex) {
            for (var t = 0; t < tracks.numTracks; t++) {
              if (onlyTrackIndex !== null && t !== onlyTrackIndex) continue;
              for (var c = 0; c < tracks[t].clips.numItems; c++) {
                var clip = tracks[t].clips[c];
                if (selectedOnly && !clip.isSelected()) continue;
                if (trackType !== effectType) {
                  if (selectedOnly) selectedIncompatible++;
                  continue;
                }
                targets.push({ clip: clip, trackIndex: t, trackType: trackType, qeClip: null, beforeCount: 0 });
              }
            }
          }

          if (target === "selected") {
            collectTracks(seq.videoTracks, "video", true, null);
            collectTracks(seq.audioTracks, "audio", true, null);
          } else if (target === "track") {
            var requestedTrackType = "${args.track_type || "video"}";
            var requestedTrackIndex = ${args.track_index ?? 0};
            if (requestedTrackType !== effectType) {
              return __error("Effect " + effectName + " is a " + effectType + " effect and cannot be applied to an " + requestedTrackType + " track. No mutation was attempted.");
            }
            var requestedTracks = requestedTrackType === "video" ? seq.videoTracks : seq.audioTracks;
            if (requestedTrackIndex >= requestedTracks.numTracks) return __error("Track index out of range");
            collectTracks(requestedTracks, requestedTrackType, false, requestedTrackIndex);
          } else {
            collectTracks(effectType === "video" ? seq.videoTracks : seq.audioTracks, effectType, false, null);
          }

          if (targets.length === 0) {
            return __error("No compatible " + effectType + " clips matched target " + target + ". No mutation was attempted.");
          }

          function findQeClip(target) {
            var qeTrack = target.trackType === "video"
              ? qeSeq.getVideoTrackAt(target.trackIndex)
              : qeSeq.getAudioTrackAt(target.trackIndex);
            if (!qeTrack) return null;
            var expectedStart = parseFloat(target.clip.start.ticks);
            for (var qi = 0; qi < qeTrack.numItems; qi++) {
              var candidate = qeTrack.getItemAt(qi);
              if (!candidate || String(candidate.type) !== "Clip") continue;
              try {
                if (Math.abs(parseFloat(candidate.start.ticks) - expectedStart) < 1) return candidate;
              } catch (lookupError) {}
            }
            return null;
          }

          function countEffectComponents(clip) {
            var count = 0;
            for (var ci = 0; ci < clip.components.numItems; ci++) {
              var component = clip.components[ci];
              if (component.displayName === effectName || component.matchName === effectName) count++;
            }
            return count;
          }

          // Resolve every QE clip before changing anything. QE item indexes include
          // gaps, so a DOM clip index cannot safely be used as a QE item index.
          for (var preflightIndex = 0; preflightIndex < targets.length; preflightIndex++) {
            var preflightTarget = targets[preflightIndex];
            preflightTarget.qeClip = findQeClip(preflightTarget);
            if (!preflightTarget.qeClip) {
              return __error("Could not match a selected " + effectType + " clip to its QE item. No effects were applied.");
            }
            preflightTarget.beforeCount = countEffectComponents(preflightTarget.clip);
          }

          var applied = 0;
          var failures = [];
          for (var targetIndex = 0; targetIndex < targets.length; targetIndex++) {
            var current = targets[targetIndex];
            try {
              if (effectType === "audio") current.qeClip.addAudioEffect(qeEffect);
              else current.qeClip.addVideoEffect(qeEffect);
            } catch (applyError) {
              failures.push("track " + current.trackIndex + ": " + applyError.toString());
              continue;
            }
            var afterCount = countEffectComponents(current.clip);
            if (afterCount <= current.beforeCount) {
              failures.push("track " + current.trackIndex + ": component count did not increase");
              continue;
            }
            applied++;
          }

          if (failures.length > 0) {
            return __error("Batch effect application was only partially verified (" + applied + "/" + targets.length + "). Do not retry blindly; inspect Effect Controls. Failures: " + failures.join("; "));
          }

          return __result({ applied: applied, verified: true, effect: effectName, effectType: effectType, target: target, selectedIncompatible: selectedIncompatible });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect_by_name: {
      description: "Remove all instances of a specific effect from a clip by display name. Returns a capability error when the host cannot remove individual components.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect to remove",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var matches = [];
          // Record matching indices from back to front. This both keeps indexes
          // stable during removal and lets us preflight every match before any
          // mutation, so an unsupported Amplify component cannot cause a partial
          // all-matches removal.
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (clip.components[i].displayName === effectName) {
              matches.push(i);
            }
          }

          if (matches.length === 0) return __error("Effect not found: " + effectName);

          function canRemoveComponent(component) {
            try {
              return !!component && typeof component.remove === "function";
            } catch (e) {
              return false;
            }
          }

          // QE offers only removeEffects(), which would also remove unrelated
          // effects. Do not substitute that broad mutation for this targeted tool.
          for (var j = 0; j < matches.length; j++) {
            var component = clip.components[matches[j]];
            if (!canRemoveComponent(component)) {
              return __error("Premiere does not expose Component.remove() for \"" + effectName + "\". No matching components were removed. No safe targeted QE fallback exists; remove it manually in Effect Controls.");
            }
          }

          var removed = 0;
          for (var j = 0; j < matches.length; j++) {
            var component = clip.components[matches[j]];
            try {
              component.remove();
              removed++;
            } catch (e) {
              return __error("Premiere could not remove \"" + effectName + "\" after removing " + removed + " matching component(s): " + e.toString() + ". Inspect Effect Controls before retrying.");
            }
          }

          return __result({ removed: removed, effect: effectName, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_blend_mode: {
      description: "Set the blend mode on a video clip. Uses the Opacity effect's Blend Mode property.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the video clip",
          },
          blend_mode: {
            type: "string",
            enum: [
              "Normal", "Dissolve", "Darken", "Multiply", "Color Burn", "Linear Burn", "Darker Color",
              "Lighten", "Screen", "Color Dodge", "Linear Dodge", "Lighter Color",
              "Overlay", "Soft Light", "Hard Light", "Vivid Light", "Linear Light", "Pin Light", "Hard Mix",
              "Difference", "Exclusion", "Subtract", "Divide",
              "Hue", "Saturation", "Color", "Luminosity"
            ],
            description: "Blend mode name",
          },
        },
        required: ["node_id", "blend_mode"],
      },
      handler: async (args: { node_id: string; blend_mode: string }) => {
        const blendModeMap: Record<string, number> = {
          "Normal": 1, "Dissolve": 2, "Darken": 3, "Multiply": 4, "Color Burn": 5,
          "Linear Burn": 6, "Darker Color": 7, "Lighten": 8, "Screen": 9, "Color Dodge": 10,
          "Linear Dodge": 11, "Lighter Color": 12, "Overlay": 13, "Soft Light": 14,
          "Hard Light": 15, "Vivid Light": 16, "Linear Light": 17, "Pin Light": 18,
          "Hard Mix": 19, "Difference": 20, "Exclusion": 21, "Subtract": 22, "Divide": 23,
          "Hue": 24, "Saturation": 25, "Color": 26, "Luminosity": 27
        };
        const modeValue = blendModeMap[args.blend_mode] ?? 1;

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Opacity") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Blend Mode") {
                  comp.properties[p].setValue(${modeValue}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }

          if (!set) return __error("Could not find Blend Mode property on clip");
          return __result({ blendMode: "${escapeForExtendScript(args.blend_mode)}", clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
