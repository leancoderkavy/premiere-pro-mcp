import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

const CLIP_TIME = "Seconds from the clip's start on the timeline (0 is the clip's first frame)";

/** Reject times and values that would otherwise be written into the generated script unchecked. */
function keyframeArgumentError(args: Record<string, unknown>, timeNames: string[], valueName?: string): string | null {
  for (const name of timeNames) {
    const value = args[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `${name} must be a finite, non-negative number of seconds from the clip's start.`;
    }
  }
  if (valueName && (typeof args[valueName] !== "number" || !Number.isFinite(args[valueName]))) {
    return `${valueName} must be a finite number.`;
  }
  return null;
}

function propertyIndexError(propertyIndex: number | undefined): string | null {
  return propertyIndex !== undefined && (!Number.isInteger(propertyIndex) || propertyIndex < 0)
    ? "property_index must be a non-negative integer."
    : null;
}

// Find clip, component and one unambiguous property. get_effect_properties returns indices.
function propertyLookupScript(args: { node_id: string; effect_name: string; property_name: string; property_index?: number }): string {
  return `
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
          var resolvedProperty = __resolveProperty(comp, "${escapeForExtendScript(args.property_name)}", ${args.property_index === undefined ? "null" : args.property_index});
          if (resolvedProperty.error) return __error(resolvedProperty.error);
          var prop = resolvedProperty.property;
          if (!prop) return __error("Property not found: ${escapeForExtendScript(args.property_name)}");`;
}

function propertyIndexParameter() {
  return { type: "integer" as const, minimum: 0, description: "Optional property index from get_effect_properties; required when property_name is duplicated." };
}

// Resolve the clip's key time base and refuse a time past the clip's end.
function keyBaseScript(times: Array<[string, number]>): string {
  return `
          var keyBase = __clipKeyframeBase(clip);
          if (!keyBase.ok) return __error(keyBase.error);
          ${times
            .map(
              ([name, seconds]) =>
                `if (${seconds} > keyBase.durationSeconds + 0.0005) return __error("${name} ${seconds}s is past the clip's end at " + keyBase.durationSeconds + "s. Nothing was changed.");`,
            )
            .join("\n          ")}`;
}

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
            var color = __readColorValue(prop);
            if (color) {
              info.value = color;
              info.valueType = "color_argb";
              try { if (prop.isTimeVarying()) info.note = "Animated colour: getColorValue() reports the current value, not each keyframe value."; } catch (eColorAnimation) {}
            } else {
              try {
                var readable = __readableParamValue(prop, prop.getValue(0, 0));
                info.value = readable.value;
                if (readable.valueType) info.valueType = readable.valueType;
              } catch(e) {}
            }
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
      description:
        "Set one effect property. Duplicate names require property_index from get_effect_properties. Colour values use [alpha, red, green, blue] and the lossless colour API; keyframed writes are refused. Readback reports verified, failed or committed_unverified; unreadable values are never reported as applied.",
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
            description: "Display name of the property; duplicate names require property_index.",
          },
          property_index: propertyIndexParameter(),
          value: {
            type: ["number", "string", "boolean", "array", "object"],
            maxLength: 8192,
            items: { type: "number" },
            minItems: 1,
            maxItems: 4,
            additionalProperties: true,
            description:
              "Value to set. Use a number for scalar properties, an array of numbers for vector properties such as Motion > Position or Anchor Point ([x, y]), a boolean for checkbox properties, the exact JSON string reported for a MOGRT text or graphic parameter, or that same JSON object if the client parsed it.",
          },
        },
        required: ["node_id", "effect_name", "property_name", "value"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; property_index?: number; value: number | string | boolean | number[] | Record<string, unknown> }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        if (Array.isArray(args.value)) {
          if (!args.value.length || args.value.length > 4) {
            return { success: false, error: "value must be an array of 1 to 4 numbers for a vector property" };
          }
          if (args.value.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
            return { success: false, error: "every component of a vector value must be a finite number" };
          }
        } else if (typeof args.value === "number" && !Number.isFinite(args.value)) {
          return { success: false, error: "value must be a finite number" };
        }
        const requestedValue = Array.isArray(args.value)
          ? `[${args.value.map((component) => String(component)).join(", ")}]`
          : args.value !== null && typeof args.value === "object"
            ? `"${escapeForExtendScript(JSON.stringify(args.value))}"`
            : typeof args.value === "string"
              ? `"${escapeForExtendScript(args.value)}"`
              : String(args.value);
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
          
          var resolvedProperty = __resolveProperty(comp, "${escapeForExtendScript(args.property_name)}", ${args.property_index === undefined ? "null" : args.property_index});
          if (resolvedProperty.error) return __error(resolvedProperty.error);
          var prop = resolvedProperty.property;
          if (!prop) return __error("Property not found: ${escapeForExtendScript(args.property_name)}");

          var requestedValue = ${requestedValue};
          var currentColor = __readColorValue(prop);
          if (currentColor) {
            var colorVarying = false;
            try { colorVarying = !!prop.isTimeVarying(); } catch (colorVaryingError) { return __error("Colour animation state could not be read; nothing was changed."); }
            if (colorVarying) return __error("Keyframed colour parameters cannot be changed through set_effect_property because CEP has no lossless time-specific colour API; nothing was changed.");
            if (!(requestedValue instanceof Array) || requestedValue.length !== 4) return __error("Colour values require [alpha, red, green, blue]; nothing was changed.");
            for (var colorIndex = 0; colorIndex < 4; colorIndex++) {
              if (typeof requestedValue[colorIndex] !== "number" || Math.floor(requestedValue[colorIndex]) !== requestedValue[colorIndex] || requestedValue[colorIndex] < 0 || requestedValue[colorIndex] > 255) return __error("Colour channels must be integers from 0 to 255; nothing was changed.");
            }
            try { prop.setColorValue(requestedValue[0], requestedValue[1], requestedValue[2], requestedValue[3], true); }
            catch (colorWriteError) { return __error("Premiere could not set the requested colour property: " + colorWriteError.toString()); }
            var colorReadback = __readColorValue(prop);
            if (!colorReadback) return __result({ set: null, valueType: "color_argb", effect: "${escapeForExtendScript(args.effect_name)}", property: "${escapeForExtendScript(args.property_name)}", propertyIndex: resolvedProperty.index, value: null, requestedValue: requestedValue, appliedValue: null, readbackVerified: false, verified: false, outcome: "committed_unverified", verification: "Colour write returned but lossless readback is unavailable; verify rendered output before delivery." });
            var colorVerified = true;
            for (var colorReadIndex = 0; colorReadIndex < 4; colorReadIndex++) if (Math.abs(colorReadback[colorReadIndex] - requestedValue[colorReadIndex]) > 1) colorVerified = false;
            var colorData = { set: colorVerified, effect: "${escapeForExtendScript(args.effect_name)}", property: "${escapeForExtendScript(args.property_name)}", propertyIndex: resolvedProperty.index, value: colorReadback, requestedValue: requestedValue, appliedValue: colorReadback, valueType: "color_argb", readbackVerified: colorVerified, verified: colorVerified, outcome: colorVerified ? "verified" : "failed", verification: "Premiere parameter readback only; verify rendered output before delivery." };
            if (!colorVerified) return __error("Premiere colour readback does not match the requested value.", colorData);
            return __result(colorData);
          }
          if (typeof prop.isTimeVarying === "function") {
            try { if (prop.isTimeVarying()) return __error("Keyframed parameters require a time-specific keyframe tool; nothing was changed."); }
            catch (animationReadError) { return __error("Parameter animation state could not be read; nothing was changed."); }
          }
          try {
            prop.setValue(requestedValue, true);
          } catch (e) {
            return __error("Premiere could not set the requested effect property: " + e.toString());
          }

          var readbackValue;
          var readbackAvailable = true;
          try {
            readbackValue = prop.getValue();
            if (readbackValue === undefined || readbackValue === null || (typeof readbackValue === "number" && !isFinite(readbackValue))) readbackAvailable = false;
          } catch (eReadback) {
            readbackAvailable = false;
          }
          // Array-shaped properties (Position, Anchor Point, and other vector
          // parameters) are never === equal to the written value, so compare
          // element by element with the same tolerance used for scalars.
          function __sameParameterValue(actual, expected) {
            var tolerance = 0.0001;
            var actualIsArray = actual instanceof Array;
            var expectedIsArray = expected instanceof Array;
            if (actualIsArray !== expectedIsArray) return false;
            if (actualIsArray) {
              if (actual.length !== expected.length) return false;
              for (var index = 0; index < expected.length; index++) {
                if (!__sameParameterValue(actual[index], expected[index])) return false;
              }
              return true;
            }
            if (typeof actual === "number" && typeof expected === "number") {
              return Math.abs(actual - expected) <= tolerance;
            }
            return actual === expected;
          }
          var parameterVerified = readbackAvailable && __sameParameterValue(readbackValue, requestedValue);
          var parameterData = {
            set: readbackAvailable ? parameterVerified : null,
            verified: parameterVerified,
            outcome: !readbackAvailable ? "committed_unverified" : (parameterVerified ? "verified" : "failed"),
            appliedValue: readbackAvailable ? readbackValue : null,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            propertyIndex: resolvedProperty.index,
            value: readbackAvailable ? readbackValue : null,
            requestedValue: requestedValue,
            readbackVerified: readbackAvailable && __sameParameterValue(readbackValue, requestedValue),
            verification: readbackAvailable
              ? "Premiere parameter readback only; verify playback or exported frames before delivery."
              : "Premiere accepted the parameter write, but this property did not expose a readback value. Verify playback or exported frames before delivery."
          };
          if (readbackAvailable && !parameterVerified) return __error("Premiere parameter readback does not match the requested value.", parameterData);
          return __result(parameterData);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_keyframes: {
      description: "Get all keyframes for a specific effect property on a clip. Each key's time is in seconds from the clip's start; mediaSeconds is Premiere's stored media time.",
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
          property_index: propertyIndexParameter(),
        },
        required: ["node_id", "effect_name", "property_name"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; property_index?: number }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
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
          
          var resolvedProperty = __resolveProperty(comp, "${escapeForExtendScript(args.property_name)}", ${args.property_index === undefined ? "null" : args.property_index});
          if (resolvedProperty.error) return __error(resolvedProperty.error);
          var prop = resolvedProperty.property;
          if (!prop) return __error("Property not found");
          
          var isTimeVarying = false;
          try { isTimeVarying = prop.isTimeVarying(); } catch(e) {}
          
          if (!isTimeVarying) {
            return __result({ keyframes: [], isTimeVarying: false, message: "Property has no keyframes" });
          }
          if (__readColorValue(prop)) return __error("Keyframed colour values cannot be read losslessly through CEP; key times may be inspected in Effect Controls, but no colour samples are returned.");
          
          // Without a usable time base (speed change, reverse) only media time is reported.
          var keyBase = __clipKeyframeBase(clip);
          var keys = prop.getKeys();
          var keyframes = [];
          if (keys) {
            for (var k = 0; k < keys.length; k++) {
              var time = keys[k];
              var val = null;
              try { val = prop.getValueAtKey(time); } catch(e) {}
              keyframes.push({
                time: keyBase.ok ? __clipSecondsFromKey(keyBase, time) : null,
                mediaSeconds: __ticksToSeconds(time.ticks),
                value: val
              });
            }
          }

          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            isTimeVarying: true,
            timeBase: keyBase.ok ? "time is seconds from the clip's start; mediaSeconds is Premiere's stored key time" : keyBase.error,
            keyframes: keyframes
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_keyframe: {
      description:
        "Add and read back a keyframe on an effect property. The receipt warns when its time is outside the clip's visible range. This verifies stored parameter data only; render/playback verification remains host-dependent.",
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
          property_index: propertyIndexParameter(),
          time_seconds: {
            type: "number",
            description: `${CLIP_TIME} where to add the keyframe`,
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
        property_index?: number;
        time_seconds: number;
        value: number;
      }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        const invalid = keyframeArgumentError(args, ["time_seconds"], "value");
        if (invalid) return { success: false, error: invalid };
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var clipDurationTicks = NaN;
          try { clipDurationTicks = parseFloat(clip.end.ticks) - parseFloat(clip.start.ticks); } catch(eDuration) {}
          var requestedKeyTicks = __secondsToTicks(${args.time_seconds});
          var outsideVisibleRange = isFinite(clipDurationTicks)
            ? (requestedKeyTicks < 0 || requestedKeyTicks >= clipDurationTicks)
            : null;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var resolvedProperty = __resolveProperty(comp, "${escapeForExtendScript(args.property_name)}", ${args.property_index === undefined ? "null" : args.property_index});
          if (resolvedProperty.error) return __error(resolvedProperty.error);
          var prop = resolvedProperty.property;
          if (!prop) return __error("Property not found");
          if (__readColorValue(prop)) return __error("Keyframed colour writes are not supported by CEP because no lossless time-specific colour setter exists; nothing was changed.");
          try {
            if (!prop.areKeyframesSupported()) return __error("Property does not support keyframes");
          } catch(eSupports) {}
          ${keyBaseScript([["time_seconds", args.time_seconds]])}

          // Enable keyframes if not already
          try {
            if (!prop.isTimeVarying()) {
              prop.setTimeVarying(true);
            }
          } catch(e) {}

          var time = __clipKeyTime(keyBase, ${args.time_seconds});
          prop.addKey(time);
          prop.setValueAtKey(time, ${args.value}, true);
          var readBack = null;
          try { readBack = prop.getValueAtKey(time); } catch(eReadBack) {}
          if (readBack === null || readBack === undefined) {
            return __error("Premiere did not return the keyframe value after writing it; storage is not reported as verified.");
          }
          if (typeof readBack === "number" && Math.abs(readBack - ${args.value}) > 0.0001) {
            return __error("Premiere returned " + readBack + " after writing keyframe value ${args.value}; storage is not reported as verified.");
          }
          
          return __result({
            added: true,
            stored: true,
            renderVerified: false,
            verificationScope: "Premiere parameter readback only; verify playback or exported frames before relying on visual output.",
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            mediaSeconds: __ticksToSeconds(time.ticks),
            value: ${args.value},
            readBackValue: readBack,
            keyframesOutsideVisibleRange: outsideVisibleRange === null ? null : (outsideVisibleRange ? 1 : 0),
            warning: outsideVisibleRange === true
              ? "The keyframe was stored outside the clip's visible range and will not appear during this clip. It may block later trims; inspect the clip before relying on it."
              : (outsideVisibleRange === null ? "The clip's visible range could not be read, so keyframe visibility is unverified." : null)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe: {
      description: "Remove the keyframe at a time from an effect property and read the remaining keys back. Refuses, changing nothing, when no key is within 0.01s of that time.",
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
          property_index: propertyIndexParameter(),
          time_seconds: {
            type: "number",
            description: `${CLIP_TIME} of the keyframe to remove`,
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; property_index?: number; time_seconds: number }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        const invalid = keyframeArgumentError(args, ["time_seconds"]);
        if (invalid) return { success: false, error: invalid };
        const script = buildToolScript(`
          ${propertyLookupScript(args)}
          ${keyBaseScript([["time_seconds", args.time_seconds]])}

          var key = __findKeyNear(prop, __clipKeyTime(keyBase, ${args.time_seconds}));
          if (!key) {
            return __error("No keyframe at ${args.time_seconds}s on this property; keys are at [" + __clipKeySeconds(keyBase, prop).join(", ") + "]s from the clip's start. Nothing was changed.");
          }
          var removedSeconds = __clipSecondsFromKey(keyBase, key);
          prop.removeKey(key);
          var remaining = null;
          var stillPresent = false;
          try {
            remaining = __clipKeySeconds(keyBase, prop, true);
            stillPresent = !!__findKeyExact(prop, key);
          } catch (readError) {
            return __jsonStringify({ success: false, error: "Premiere accepted the keyframe removal, but the remaining keys could not be read back: " + readError.toString(), data: { outcome: "committed_unverified", timelineChanged: null, verified: false } });
          }
          if (stillPresent) {
            return __jsonStringify({ success: false, error: "Premiere accepted the removal, but a keyframe still reads back at " + removedSeconds + "s.", data: { outcome: "committed_unverified", timelineChanged: true, remainingKeys: remaining } });
          }

          return __result({
            removed: true,
            verified: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: removedSeconds,
            remainingKeys: remaining
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe_range: {
      description: "Remove every keyframe in a time range (inclusive) from an effect property and read the remaining keys back. Refuses, changing nothing, when the range holds no key.",
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
          property_index: propertyIndexParameter(),
          start_seconds: {
            type: "number",
            description: `Start of the range: ${CLIP_TIME.toLowerCase()}`,
          },
          end_seconds: {
            type: "number",
            description: "End of the range, in seconds from the clip's start; must not be before start_seconds",
          },
        },
        required: ["node_id", "effect_name", "property_name", "start_seconds", "end_seconds"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        property_index?: number;
        start_seconds: number;
        end_seconds: number;
      }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        const invalid = keyframeArgumentError(args, ["start_seconds", "end_seconds"]);
        if (invalid) return { success: false, error: invalid };
        if (args.end_seconds < args.start_seconds) return { success: false, error: "end_seconds must not be before start_seconds." };
        const script = buildToolScript(`
          ${propertyLookupScript(args)}
          ${keyBaseScript([["start_seconds", args.start_seconds], ["end_seconds", args.end_seconds]])}

          function __keysInRange(strict) {
            var found = [];
            var all = __clipKeySeconds(keyBase, prop, strict);
            for (var k = 0; k < all.length; k++) {
              if (all[k] >= ${args.start_seconds} - 0.0005 && all[k] <= ${args.end_seconds} + 0.0005) found.push(all[k]);
            }
            return found;
          }
          var inRange = __keysInRange();
          if (!inRange.length) {
            return __error("No keyframes between ${args.start_seconds}s and ${args.end_seconds}s; keys are at [" + __clipKeySeconds(keyBase, prop).join(", ") + "]s from the clip's start. Nothing was changed.");
          }
          var removedStoredKeys = [];
          for (var r = 0; r < inRange.length; r++) {
            var key = __findKeyNear(prop, __clipKeyTime(keyBase, inRange[r]));
            if (key) { removedStoredKeys.push(key); prop.removeKey(key); }
          }
          var left = null;
          var remaining = null;
          try {
            left = [];
            for (var rk = 0; rk < removedStoredKeys.length; rk++) if (__findKeyExact(prop, removedStoredKeys[rk])) left.push(__clipSecondsFromKey(keyBase, removedStoredKeys[rk]));
            remaining = __clipKeySeconds(keyBase, prop, true);
          } catch (readError) {
            return __jsonStringify({ success: false, error: "Premiere accepted keyframe removals, but the remaining keys could not be read back: " + readError.toString(), data: { outcome: "committed_unverified", timelineChanged: null, verified: false } });
          }
          if (left.length) {
            return __jsonStringify({ success: false, error: "Premiere accepted the removal, but keyframes still read back at [" + left.join(", ") + "]s.", data: { outcome: "committed_unverified", timelineChanged: true, remainingKeys: remaining } });
          }

          return __result({
            removed: true,
            verified: true,
            removedCount: inRange.length,
            removedKeys: inRange,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            range: { start: ${args.start_seconds}, end: ${args.end_seconds} },
            remainingKeys: remaining
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_keyframe_interpolation: {
      description: "Set the interpolation type of an existing keyframe (Linear, Hold, or Bezier). Premiere exposes no interpolation readback, so a write is reported as committed_unverified. Stored curves do not establish rendering; verify with a short video export, or with PNG stills composited over black (they carry straight alpha).",
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
          property_index: propertyIndexParameter(),
          time_seconds: {
            type: "number",
            description: `${CLIP_TIME} of the keyframe`,
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
        property_index?: number;
        time_seconds: number;
        interpolation: string;
      }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        const invalid = keyframeArgumentError(args, ["time_seconds"]);
        if (invalid) return { success: false, error: invalid };
        // Live 25.2.3, two keys 20 -> 80 sampled at 25/50/75%: 0 gave 35/50/65
        // (linear) and 4 held 20; 5 matches linear until its handles are moved.
        const interpMap: Record<string, number> = { linear: 0, hold: 4, bezier: 5 };
        if (!Object.prototype.hasOwnProperty.call(interpMap, args.interpolation)) return { success: false, error: "interpolation must be linear, hold or bezier." };
        const interpType = interpMap[args.interpolation];

        const script = buildToolScript(`
          ${propertyLookupScript(args)}
          ${keyBaseScript([["time_seconds", args.time_seconds]])}

          var key = __findKeyNear(prop, __clipKeyTime(keyBase, ${args.time_seconds}));
          if (!key) {
            return __error("No keyframe at ${args.time_seconds}s on this property; keys are at [" + __clipKeySeconds(keyBase, prop).join(", ") + "]s from the clip's start. Nothing was changed.");
          }
          prop.setInterpolationTypeAtKey(key, ${interpType}, true);

          return __result({
            set: true,
            outcome: "committed_unverified",
            verified: false,
            verificationScope: "Premiere has no interpolation getter; get_value_at_time samples stored property values only, not rendered pixels.",
            renderVerified: false,
            renderHonesty: "Stored curves are not render proof. On Premiere 26.5.2 macOS, an actual H.264 export and QE PNG stills composited over black both distinguished linear, hold and bezier. Read without their alpha channel, those stills look identical across modes, which matches the earlier still-capture reports in #771. Verify curves with a short video export, or with PNG stills composited over black.",
            interpolation: "${args.interpolation}",
            time: __clipSecondsFromKey(keyBase, key)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_value_at_time: {
      description: "Get the interpolated value of an effect property at a time, in seconds from the clip's start",
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
          property_index: propertyIndexParameter(),
          time_seconds: {
            type: "number",
            description: `${CLIP_TIME} to read the value at`,
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; property_index?: number; time_seconds: number }) => {
        const indexError = propertyIndexError(args.property_index);
        if (indexError) return { success: false, error: indexError };
        const invalid = keyframeArgumentError(args, ["time_seconds"]);
        if (invalid) return { success: false, error: invalid };
        const script = buildToolScript(`
          ${propertyLookupScript(args)}
          ${keyBaseScript([["time_seconds", args.time_seconds]])}

          var time = __clipKeyTime(keyBase, ${args.time_seconds});
          var readableValue;
          var colorValue = __readColorValue(prop);
          if (colorValue) {
            var colorTimeVarying = false;
            try { colorTimeVarying = !!prop.isTimeVarying(); } catch (colorTimeError) { return __error("Colour animation state could not be read, so no value is reported."); }
            if (colorTimeVarying) return __error("Keyframed colour cannot be sampled losslessly through CEP; use Effect Controls to inspect that time.");
            readableValue = { value: colorValue, valueType: "color_argb" };
          } else {
            readableValue = __readableParamValue(prop, prop.getValueAtTime(time));
          }
          var value = readableValue.value;

          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            mediaSeconds: __ticksToSeconds(time.ticks),
            value: value,
            valueType: readableValue.valueType || null,
            note: readableValue.note || undefined
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
