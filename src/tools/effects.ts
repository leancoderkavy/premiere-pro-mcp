import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getEffectsTools(bridgeOptions: BridgeOptions) {
  return {
    apply_effect: {
      description: "Apply a video effect to a clip. Uses QE DOM for effect lookup.",
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
          
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          // Search for the effect
          var effects = qe.project.getVideoEffectList();
          var found = false;
          for (var i = 0; i < effects.numItems; i++) {
            if (effects[i].name === effectName) {
              qeClip.addVideoEffect(effects[i]);
              found = true;
              break;
            }
          }
          
          if (!found) return __error("Effect not found: " + effectName);
          return __result({ applied: true, effect: effectName, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_audio_effect: {
      description: "Apply an audio effect to a clip",
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
          
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          var effects = qe.project.getAudioEffectList();
          var found = false;
          for (var i = 0; i < effects.numItems; i++) {
            if (effects[i].name === effectName) {
              qeClip.addAudioEffect(effects[i]);
              found = true;
              break;
            }
          }
          
          if (!found) return __error("Audio effect not found: " + effectName);
          return __result({ applied: true, effect: effectName });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect: {
      description: "Remove an effect from a clip by its index or name",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_index: {
            type: "number",
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
          if (${args.effect_index} >= clip.components.numItems) return __error("Effect index out of range");
          var effectName = clip.components[${args.effect_index}].displayName;
          clip.components[${args.effect_index}].remove();
          return __result({ removed: true, effect: effectName });
          ` : `
          var effectName = "${escapeForExtendScript(args.effect_name || "")}";
          var found = false;
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (clip.components[i].displayName === effectName) {
              clip.components[i].remove();
              found = true;
              break;
            }
          }
          if (!found) return __error("Effect not found: " + effectName);
          return __result({ removed: true, effect: effectName });
          `}
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_effects: {
      description: "List all available video effects in Premiere Pro. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var effects = qe.project.getVideoEffectList();
          var list = [];
          for (var i = 0; i < effects.numItems; i++) {
            list.push({ name: effects[i].name, index: i });
          }
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
          var effects = qe.project.getAudioEffectList();
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
      description: "Apply basic color correction to a clip using Lumetri Color",
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
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") {
              hasLumetri = true;
              break;
            }
          }
          
          if (!hasLumetri) {
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            var qeClip = qeTrack.getItemAt(result.clipIndex);
            var effects = qe.project.getVideoEffectList();
            for (var i = 0; i < effects.numItems; i++) {
              if (effects[i].name === "Lumetri Color") {
                qeClip.addVideoEffect(effects[i]);
                break;
              }
            }
          }
          
          // Set Lumetri properties
          var changes = {};
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Lumetri Color") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var name = prop.displayName;
                ${args.exposure !== undefined ? `if (name === "Exposure") { prop.setValue(${args.exposure}, true); changes.exposure = ${args.exposure}; }` : ""}
                ${args.contrast !== undefined ? `if (name === "Contrast") { prop.setValue(${args.contrast}, true); changes.contrast = ${args.contrast}; }` : ""}
                ${args.highlights !== undefined ? `if (name === "Highlights") { prop.setValue(${args.highlights}, true); changes.highlights = ${args.highlights}; }` : ""}
                ${args.shadows !== undefined ? `if (name === "Shadows") { prop.setValue(${args.shadows}, true); changes.shadows = ${args.shadows}; }` : ""}
                ${args.whites !== undefined ? `if (name === "Whites") { prop.setValue(${args.whites}, true); changes.whites = ${args.whites}; }` : ""}
                ${args.blacks !== undefined ? `if (name === "Blacks") { prop.setValue(${args.blacks}, true); changes.blacks = ${args.blacks}; }` : ""}
                ${args.temperature !== undefined ? `if (name === "Temperature") { prop.setValue(${args.temperature}, true); changes.temperature = ${args.temperature}; }` : ""}
                ${args.tint !== undefined ? `if (name === "Tint") { prop.setValue(${args.tint}, true); changes.tint = ${args.tint}; }` : ""}
                ${args.saturation !== undefined ? `if (name === "Saturation") { prop.setValue(${args.saturation}, true); changes.saturation = ${args.saturation}; }` : ""}
              }
              break;
            }
          }
          
          return __result({ colorCorrected: true, clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_lut: {
      description: "Apply a LUT file to a clip via Lumetri Color",
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
        const script = buildToolScript(`
          app.enableQE();
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          
          // Find or apply Lumetri Color
          var lumetriComp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") {
              lumetriComp = clip.components[i];
              break;
            }
          }
          
          if (!lumetriComp) {
            var qeSeq = qe.project.getActiveSequence();
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            var qeClip = qeTrack.getItemAt(result.clipIndex);
            var effects = qe.project.getVideoEffectList();
            for (var i = 0; i < effects.numItems; i++) {
              if (effects[i].name === "Lumetri Color") {
                qeClip.addVideoEffect(effects[i]);
                break;
              }
            }
            // Re-find the component
            for (var i = 0; i < clip.components.numItems; i++) {
              if (clip.components[i].displayName === "Lumetri Color") {
                lumetriComp = clip.components[i];
                break;
              }
            }
          }
          
          if (!lumetriComp) return __error("Could not apply Lumetri Color effect");
          
          // Set the LUT path
          for (var p = 0; p < lumetriComp.properties.numItems; p++) {
            var prop = lumetriComp.properties[p];
            if (prop.displayName === "Input LUT") {
              prop.setValue("${escapeForExtendScript(args.lut_path)}", true);
              break;
            }
          }
          
          return __result({ lutApplied: true, clipName: clip.name, lutPath: "${escapeForExtendScript(args.lut_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stabilize_clip: {
      description: "Apply the Warp Stabilizer effect to a clip for video stabilization. Uses QE DOM.",
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
          
          var qeClip = qeTrack.getItemAt(result.clipIndex);
          if (!qeClip) return __error("QE clip not found");
          
          // Find and apply Warp Stabilizer
          var effects = qe.project.getVideoEffectList();
          var found = false;
          for (var i = 0; i < effects.numItems; i++) {
            if (effects[i].name === "Warp Stabilizer") {
              qeClip.addVideoEffect(effects[i]);
              found = true;
              break;
            }
          }
          
          if (!found) return __error("Warp Stabilizer effect not found");
          
          // Set properties if specified
          var clip = result.clip;
          var changes = { stabilized: true };
          ${args.smoothness !== undefined || args.method !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Warp Stabilizer") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.smoothness !== undefined ? `
                if (prop.displayName === "Smoothness") {
                  prop.setValue(${args.smoothness}, true);
                  changes.smoothness = ${args.smoothness};
                }` : ""}
                ${args.method !== undefined ? `
                if (prop.displayName === "Method") {
                  prop.setValue("${escapeForExtendScript(args.method)}", true);
                  changes.method = "${escapeForExtendScript(args.method)}";
                }` : ""}
              }
              break;
            }
          }
          ` : ""}
          
          return __result({ clipName: clip.name, info: "Warp Stabilizer applied. Analysis will begin automatically.", changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
