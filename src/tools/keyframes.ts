import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getKeyframeTools(bridgeOptions: BridgeOptions) {
  return {
    get_effect_properties: {
      description: "List all properties of a specific effect on a clip, including current values",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect (e.g., 'Motion', 'Opacity', 'Lumetri Color')",
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
          var comp = null;
          
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === effectName || clip.components[i].matchName === effectName) {
              comp = clip.components[i];
              break;
            }
          }
          
          if (!comp) return __error("Effect not found: " + effectName);
          
          var props = [];
          for (var p = 0; p < comp.properties.numItems; p++) {
            var prop = comp.properties[p];
            var info = {
              index: p,
              displayName: prop.displayName,
              isTimeVarying: false,
              keyframesSupported: false
            };
            try { info.isTimeVarying = prop.isTimeVarying(); } catch(e) {}
            try { info.keyframesSupported = prop.areKeyframesSupported(); } catch(e) {}
            try { info.value = prop.getValue(0, 0); } catch(e) {}
            props.push(info);
          }
          
          return __result({
            effect: comp.displayName,
            matchName: comp.matchName,
            properties: props
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_effect_property: {
      description: "Set the value of a specific effect property on a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect (e.g., 'Motion', 'Opacity')",
          },
          property_name: {
            type: "string",
            description: "Display name of the property (e.g., 'Scale', 'Position', 'Opacity')",
          },
          value: {
            type: "number",
            description: "Value to set",
          },
        },
        required: ["node_id", "effect_name", "property_name", "value"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; value: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found: ${escapeForExtendScript(args.effect_name)}");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found: ${escapeForExtendScript(args.property_name)}");
          
          prop.setValue(${args.value}, true);
          return __result({
            set: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            value: ${args.value}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_keyframes: {
      description: "Get all keyframes for a specific effect property on a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
        },
        required: ["node_id", "effect_name", "property_name"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var isTimeVarying = false;
          try { isTimeVarying = prop.isTimeVarying(); } catch(e) {}
          
          if (!isTimeVarying) {
            return __result({ keyframes: [], isTimeVarying: false, message: "Property has no keyframes" });
          }
          
          var keys = prop.getKeys();
          var keyframes = [];
          if (keys) {
            for (var k = 0; k < keys.length; k++) {
              var time = keys[k];
              var val = null;
              try { val = prop.getValueAtKey(time); } catch(e) {}
              keyframes.push({
                time: __ticksToSeconds(time.ticks),
                value: val
              });
            }
          }
          
          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            isTimeVarying: true,
            keyframes: keyframes
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_keyframe: {
      description: "Add a keyframe to an effect property at a specific time",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds relative to clip start where to add keyframe",
          },
          value: {
            type: "number",
            description: "Value at the keyframe",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds", "value"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        time_seconds: number;
        value: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          // Enable keyframes if not already
          try {
            if (!prop.isTimeVarying()) {
              prop.setTimeVarying(true);
            }
          } catch(e) {}
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.addKey(time);
          prop.setValueAtKey(time, ${args.value}, true);
          
          return __result({
            added: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            value: ${args.value}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe: {
      description: "Remove a keyframe at a specific time from an effect property",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds of the keyframe to remove",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; time_seconds: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.removeKey(time);
          
          return __result({
            removed: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe_range: {
      description: "Remove all keyframes in a time range from an effect property",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          start_seconds: {
            type: "number",
            description: "Start of the range in seconds",
          },
          end_seconds: {
            type: "number",
            description: "End of the range in seconds",
          },
        },
        required: ["node_id", "effect_name", "property_name", "start_seconds", "end_seconds"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        start_seconds: number;
        end_seconds: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var startTime = new Time();
          startTime.ticks = __secondsToTicks(${args.start_seconds}).toString();
          var endTime = new Time();
          endTime.ticks = __secondsToTicks(${args.end_seconds}).toString();
          prop.removeKeyRange(startTime, endTime);
          
          return __result({
            removed: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            range: { start: ${args.start_seconds}, end: ${args.end_seconds} }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_keyframe_interpolation: {
      description: "Set the interpolation type of a keyframe (Linear, Hold, or Bezier)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds of the keyframe",
          },
          interpolation: {
            type: "string",
            enum: ["linear", "hold", "bezier"],
            description: "Interpolation type",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds", "interpolation"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        time_seconds: number;
        interpolation: string;
      }) => {
        const interpMap: Record<string, number> = { linear: 0, hold: 4, bezier: 5 };
        const interpType = interpMap[args.interpolation] ?? 0;

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.setInterpolationTypeAtKey(time, ${interpType}, true);
          
          return __result({
            set: true,
            interpolation: "${args.interpolation}",
            time: ${args.time_seconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_value_at_time: {
      description: "Get the interpolated value of an effect property at a specific time",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds to query the value at",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; time_seconds: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          var value = prop.getValueAtTime(time);
          
          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            value: value
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
