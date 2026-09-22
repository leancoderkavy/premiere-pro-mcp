import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

type PasteClipAttributesArgs = {
  source_node_id: string;
  target_node_id: string;
  components?: string[];
  copy_keyframes?: boolean;
  apply_missing_effects?: boolean;
};

/** Maximum keyframes copied per property; larger curves are reported instead of truncated. */
const PASTE_ATTRIBUTES_MAX_KEYS_PER_PROPERTY = 500;

function validatePasteClipAttributesArgs(args: PasteClipAttributesArgs): string | null {
  if (!args || typeof args !== "object") return "arguments must be an object";
  for (const field of ["source_node_id", "target_node_id"] as const) {
    const value = args[field];
    if (typeof value !== "string" || !value.trim()) return `${field} must be a non-empty string`;
    if (value.length > 512) return `${field} must be at most 512 characters`;
  }
  if (args.source_node_id === args.target_node_id) return "source_node_id and target_node_id must name different clips";
  if (args.components !== undefined) {
    if (!Array.isArray(args.components) || args.components.length < 1 || args.components.length > 64) {
      return "components must be an array of 1 to 64 component names";
    }
    const seen = new Set<string>();
    for (const name of args.components) {
      if (typeof name !== "string" || !name.trim() || name.length > 256) {
        return "every components entry must be a non-empty string of at most 256 characters";
      }
      if (seen.has(name)) return `components contains a duplicate entry: ${name}`;
      seen.add(name);
    }
  }
  for (const field of ["copy_keyframes", "apply_missing_effects"] as const) {
    if (args[field] !== undefined && typeof args[field] !== "boolean") return `${field} must be a boolean`;
  }
  return null;
}

function buildPasteClipAttributesScript(args: PasteClipAttributesArgs): string {
  const filterLiteral = args.components
    ? `[${args.components.map((name) => `"${escapeForExtendScript(name)}"`).join(", ")}]`
    : "null";
  return buildToolScript(`
    var SOURCE_ID = "${escapeForExtendScript(args.source_node_id)}";
    var TARGET_ID = "${escapeForExtendScript(args.target_node_id)}";
    var componentFilter = ${filterLiteral};
    var copyKeyframes = ${args.copy_keyframes === false ? "false" : "true"};
    var applyMissingEffects = ${args.apply_missing_effects === false ? "false" : "true"};
    var MAX_KEYS = ${PASTE_ATTRIBUTES_MAX_KEYS_PER_PROPERTY};
    var INTRINSIC = ["Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner"];
    var MASK_REASON = "Masks are not exposed by ExtendScript, QE, or documented Premiere UXP; recreate or paste them manually in Effect Controls.";
    var OPAQUE_REASON = "Premiere did not expose this parameter as a readable number, boolean, string, or numeric array, so it cannot be copied or verified (masks, curves, and custom effect data fall in this group).";

    var srcFound = __findClip(SOURCE_ID);
    if (!srcFound) return __error("Source clip not found in the active sequence: " + SOURCE_ID);
    var tgtFound = __findClip(TARGET_ID);
    if (!tgtFound) return __error("Target clip not found in the active sequence: " + TARGET_ID);
    if (srcFound.trackType !== tgtFound.trackType) {
      return __error("Source is on a " + srcFound.trackType + " track but target is on a " + tgtFound.trackType + " track; paste_clip_attributes only copies between clips of the same track type. No changes were made.");
    }
    var trackType = srcFound.trackType;
    var src = srcFound.clip;

    function refreshTarget() {
      var found = __findClip(TARGET_ID);
      return found ? found.clip : null;
    }
    var tgt = tgtFound.clip;

    function inList(list, value) {
      for (var li = 0; li < list.length; li++) {
        if (list[li] === value) return true;
      }
      return false;
    }
    function isIntrinsic(name) { return inList(INTRINSIC, name); }
    function isWanted(comp) {
      if (componentFilter) return inList(componentFilter, comp.displayName) || inList(componentFilter, comp.matchName);
      return comp.displayName !== "Time Remapping";
    }
    function sameValue(actual, expected) {
      var actualIsArray = actual instanceof Array;
      var expectedIsArray = expected instanceof Array;
      if (actualIsArray !== expectedIsArray) return false;
      if (actualIsArray) {
        if (actual.length !== expected.length) return false;
        for (var ai = 0; ai < expected.length; ai++) {
          if (!sameValue(actual[ai], expected[ai])) return false;
        }
        return true;
      }
      if (typeof actual === "number" && typeof expected === "number") return Math.abs(actual - expected) <= 0.0001;
      return actual === expected;
    }
    function isCopyable(value) {
      if (typeof value === "number") return isFinite(value);
      if (typeof value === "boolean" || typeof value === "string") return true;
      if (value instanceof Array) {
        if (value.length < 1 || value.length > 16) return false;
        for (var vi = 0; vi < value.length; vi++) {
          if (typeof value[vi] !== "number" || !isFinite(value[vi])) return false;
        }
        return true;
      }
      return false;
    }
    function occurrenceOf(clip, index) {
      var matchName = clip.components[index].matchName;
      var n = 0;
      for (var oi = 0; oi < index; oi++) {
        if (clip.components[oi].matchName === matchName) n++;
      }
      return n;
    }
    function findNth(clip, matchName, occurrence) {
      var n = 0;
      for (var fi = 0; fi < clip.components.numItems; fi++) {
        if (clip.components[fi].matchName === matchName) {
          if (n === occurrence) return clip.components[fi];
          n++;
        }
      }
      return null;
    }
    function countMatch(clip, matchName) {
      var n = 0;
      for (var ci = 0; ci < clip.components.numItems; ci++) {
        if (clip.components[ci].matchName === matchName) n++;
      }
      return n;
    }
    function findTargetProperty(tgtComp, srcProp, index) {
      if (index < tgtComp.properties.numItems && tgtComp.properties[index].displayName === srcProp.displayName) {
        return tgtComp.properties[index];
      }
      var match = null;
      for (var pi = 0; pi < tgtComp.properties.numItems; pi++) {
        if (tgtComp.properties[pi].displayName === srcProp.displayName) {
          if (match) return null;
          match = tgtComp.properties[pi];
        }
      }
      return match;
    }
    function readTimeVarying(prop) {
      try { return !!prop.isTimeVarying(); } catch (eTv) { return false; }
    }
    function makeTime(ticks) {
      var t = new Time();
      t.ticks = String(ticks);
      return t;
    }

    var qeClip = null;
    var qeResolved = false;
    function resolveQeClip() {
      if (qeResolved) return qeClip;
      qeResolved = true;
      try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        var qeTrack = trackType === "video" ? qeSeq.getVideoTrackAt(tgtFound.trackIndex) : qeSeq.getAudioTrackAt(tgtFound.trackIndex);
        qeClip = __findQeClipByDomClip(qeTrack, tgt);
      } catch (eQe) {
        qeClip = null;
      }
      return qeClip;
    }
    function lookupQeEffect(name) {
      var effect = null;
      try {
        effect = trackType === "video" ? qe.project.getVideoEffectByName(name) : qe.project.getAudioEffectByName(name);
      } catch (eByName) {}
      if (effect) return effect;
      var catalog = __getQeEffectCatalog(trackType);
      if (!catalog.ok) return null;
      for (var ei = 0; ei < catalog.effects.numItems; ei++) {
        if (catalog.effects[ei].name === name) return catalog.effects[ei];
      }
      return null;
    }

    var srcIn = parseFloat(src.inPoint.ticks);
    var tgtIn = parseFloat(tgt.inPoint.ticks);
    var componentsReport = [];
    var properties = [];
    var notCopied = [];
    var skippedComponents = [];
    var counts = { verified: 0, committedUnverified: 0, failed: 0, notCopied: 0, unchanged: 0 };

    function record(entry) {
      properties.push(entry);
      if (entry.status === "verified") counts.verified++;
      else if (entry.status === "committed_unverified") counts.committedUnverified++;
      else counts.failed++;
      if (entry.action === "unchanged") counts.unchanged++;
    }
    function skip(entry) {
      notCopied.push(entry);
      counts.notCopied++;
    }

    function copyKeyframed(componentName, srcProp, tgtProp, base) {
      if (!copyKeyframes) {
        base.reason = "Source property is keyframed and copy_keyframes is false; the target was left unchanged.";
        return skip(base);
      }
      var supported = true;
      try { supported = !!tgtProp.areKeyframesSupported(); } catch (eSupported) {}
      if (!supported) {
        base.reason = "The target property does not support keyframes.";
        return skip(base);
      }
      var keys = null;
      try { keys = srcProp.getKeys(); } catch (eKeys) {}
      if (!keys || !keys.length) {
        base.reason = "Premiere reported the source property as keyframed but returned no readable keyframes.";
        return skip(base);
      }
      if (keys.length > MAX_KEYS) {
        base.reason = "Source property has " + keys.length + " keyframes, above the " + MAX_KEYS + " keyframe limit.";
        return skip(base);
      }
      var plan = [];
      for (var k = 0; k < keys.length; k++) {
        var value;
        try { value = srcProp.getValueAtKey(keys[k]); } catch (eValue) { value = undefined; }
        if (!isCopyable(value)) {
          base.reason = OPAQUE_REASON;
          return skip(base);
        }
        var mapped = parseFloat(keys[k].ticks) - srcIn + tgtIn;
        if (isNaN(mapped) || mapped < 0) {
          base.reason = "A source keyframe maps before the target media start, so the curve cannot be reproduced.";
          return skip(base);
        }
        plan.push({ ticks: mapped, value: value });
      }
      base.kind = "keyframes";
      base.keyframes = plan.length;
      base.interpolation = "not_copied";
      try {
        if (readTimeVarying(tgtProp)) tgtProp.setTimeVarying(false);
        tgtProp.setTimeVarying(true);
        for (var w = 0; w < plan.length; w++) {
          var writeTime = makeTime(plan[w].ticks);
          tgtProp.addKey(writeTime);
          tgtProp.setValueAtKey(writeTime, plan[w].value, true);
        }
      } catch (eWrite) {
        base.status = "failed";
        base.action = "written";
        base.reason = "Premiere rejected a keyframe write: " + eWrite.toString() + ". The target property may be partially changed.";
        return record(base);
      }
      base.action = "written";
      var readbackKeys = null;
      try { readbackKeys = tgtProp.getKeys(); } catch (eReadKeys) {}
      if (!readbackKeys) {
        base.status = "committed_unverified";
        base.reason = "Premiere accepted the keyframes but did not return them for readback.";
        return record(base);
      }
      if (readbackKeys.length !== plan.length) {
        base.status = "failed";
        base.reason = "Target has " + readbackKeys.length + " keyframes after the write; expected " + plan.length + ".";
        return record(base);
      }
      for (var r = 0; r < plan.length; r++) {
        var readValue;
        try { readValue = tgtProp.getValueAtKey(makeTime(plan[r].ticks)); } catch (eReadValue) { readValue = undefined; }
        if (!sameValue(readValue, plan[r].value)) {
          base.status = "failed";
          base.reason = "Keyframe " + (r + 1) + " did not read back with the source value.";
          return record(base);
        }
      }
      base.status = "verified";
      return record(base);
    }

    function copyStatic(componentName, srcProp, tgtProp, base) {
      var value;
      try { value = srcProp.getValue(); } catch (eGet) { value = undefined; }
      if (!isCopyable(value)) {
        base.reason = OPAQUE_REASON;
        return skip(base);
      }
      base.kind = "value";
      var targetAnimated = readTimeVarying(tgtProp);
      var current;
      try { current = tgtProp.getValue(); } catch (eCurrent) { current = undefined; }
      if (!targetAnimated && sameValue(current, value)) {
        base.status = "verified";
        base.action = "unchanged";
        return record(base);
      }
      if (componentName === "Opacity" && srcProp.displayName === "Blend Mode") {
        base.reason = "Source and target Blend Mode differ, and legacy CEP cross-clip enum writes can corrupt Blend Mode (issue #243); no write was attempted. Use set_blend_mode, then confirm with get_effect_properties.";
        return skip(base);
      }
      try {
        if (targetAnimated) tgtProp.setTimeVarying(false);
        tgtProp.setValue(value, true);
      } catch (eSet) {
        base.status = "failed";
        base.action = "written";
        base.reason = "Premiere rejected the value write: " + eSet.toString();
        return record(base);
      }
      base.action = "written";
      var readback;
      var readbackOk = true;
      try { readback = tgtProp.getValue(); } catch (eReadback) { readbackOk = false; }
      if (!readbackOk) {
        base.status = "committed_unverified";
        base.reason = "Premiere accepted the write but did not return a readback value.";
      } else if (sameValue(readback, value)) {
        base.status = "verified";
      } else {
        base.status = "failed";
        base.reason = "Target value did not match the source value after the write.";
      }
      return record(base);
    }

    var sourceCount = src.components.numItems;
    for (var i = 0; i < sourceCount; i++) {
      var comp = src.components[i];
      var componentName = comp.displayName;
      var matchName = comp.matchName;
      if (!isWanted(comp)) {
        skippedComponents.push({
          component: componentName,
          reason: componentFilter ? "Not named in components." : "Time Remapping is excluded unless named in components because it changes clip timing."
        });
        continue;
      }
      var occurrence = occurrenceOf(src, i);
      tgt = refreshTarget();
      if (!tgt) return __error("Target clip disappeared from the active sequence during the paste.");
      var tgtComp = findNth(tgt, matchName, occurrence);
      var componentEntry = { component: componentName, matchName: matchName, occurrence: occurrence, action: "matched_existing", status: "ok" };
      if (!tgtComp) {
        if (isIntrinsic(componentName)) {
          componentEntry.action = "none";
          componentEntry.status = "not_copied";
          componentEntry.reason = "Intrinsic component is not present on the target clip and cannot be added.";
        } else if (!applyMissingEffects) {
          componentEntry.action = "none";
          componentEntry.status = "not_copied";
          componentEntry.reason = "Effect is missing on the target and apply_missing_effects is false.";
        } else {
          componentEntry.action = "applied_via_qe";
          var qeTarget = resolveQeClip();
          var qeEffect = qeTarget ? lookupQeEffect(componentName) : null;
          if (!qeTarget) {
            componentEntry.status = "failed";
            componentEntry.reason = "The experimental QE DOM did not resolve the target clip, so the missing effect could not be applied.";
          } else if (!qeEffect) {
            componentEntry.status = "failed";
            componentEntry.reason = "The experimental QE DOM did not resolve an installed effect named \\"" + componentName + "\\".";
          } else {
            var before = countMatch(tgt, matchName);
            try {
              if (trackType === "video") qeTarget.addVideoEffect(qeEffect);
              else qeTarget.addAudioEffect(qeEffect);
            } catch (eAdd) {
              componentEntry.status = "failed";
              componentEntry.reason = "QE could not apply the effect: " + eAdd.toString();
            }
            if (componentEntry.status === "ok") {
              tgt = refreshTarget();
              if (!tgt || countMatch(tgt, matchName) <= before) {
                componentEntry.status = "failed";
                componentEntry.reason = "QE returned, but the target component count did not increase.";
              } else {
                tgtComp = findNth(tgt, matchName, occurrence);
                if (!tgtComp) {
                  componentEntry.status = "failed";
                  componentEntry.reason = "The applied effect could not be matched to this source occurrence.";
                }
              }
            }
          }
        }
      }
      componentsReport.push(componentEntry);
      if (componentEntry.status !== "ok") {
        if (componentEntry.status === "failed") counts.failed++;
        else skip({ component: componentName, property: null, reason: componentEntry.reason });
        continue;
      }

      for (var p = 0; p < comp.properties.numItems; p++) {
        var srcProp = comp.properties[p];
        var base = { component: componentName, occurrence: occurrence, property: srcProp.displayName, index: p };
        var tgtProp = findTargetProperty(tgtComp, srcProp, p);
        if (!tgtProp) {
          base.reason = "No unambiguous matching property exists on the target component.";
          skip(base);
          continue;
        }
        if (readTimeVarying(srcProp)) copyKeyframed(componentName, srcProp, tgtProp, base);
        else copyStatic(componentName, srcProp, tgtProp, base);
      }
    }

    var written = counts.verified + counts.committedUnverified - counts.unchanged;
    var status;
    if (counts.failed === 0 && counts.notCopied === 0) {
      status = counts.committedUnverified > 0 ? "committed_unverified" : "verified";
    } else if (counts.verified + counts.committedUnverified > 0) {
      status = "partial";
    } else {
      status = "failed";
    }

    return __result({
      status: status,
      source: { nodeId: SOURCE_ID, name: src.name },
      target: { nodeId: TARGET_ID, name: tgt ? tgt.name : null },
      trackType: trackType,
      summary: {
        verified: counts.verified,
        committedUnverified: counts.committedUnverified,
        failed: counts.failed,
        notCopied: counts.notCopied,
        unchanged: counts.unchanged,
        written: written
      },
      components: componentsReport,
      skippedComponents: skippedComponents,
      properties: properties,
      notCopied: notCopied,
      masks: { copied: false, detectable: false, reason: MASK_REASON },
      keyframeTiming: "Keyframe times are offset by the difference between the source and target in points; interpolation is not copied because ExtendScript has no interpolation getter.",
      verificationScope: "Premiere parameter readback only. Effect order on the target may differ from the source when effects were added. Verify playback or exported frames before delivery."
    });
  `);
}

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

    paste_clip_attributes: {
      description:
        "Paste Attributes for one timeline clip: copy the source clip's effect stack (Motion, Opacity, other intrinsic components, and every applied effect) onto a target clip of the same track type, including keyframes. Components are matched by match name and occurrence; a missing non-intrinsic effect is applied through the experimental legacy QE DOM (disable with apply_missing_effects=false). Every written parameter and keyframe value is read back and reported per property as verified, committed_unverified, or failed, with an overall status. Not copied, and listed in notCopied with a reason: parameters whose values ExtendScript cannot read as numbers, booleans, strings, or numeric arrays; Opacity > Blend Mode when it differs (legacy cross-clip enum writes can corrupt it; use set_blend_mode and verify); and keyframe interpolation (no getter exists, so pasted keys use Premiere's default interpolation). MASKS ARE NOT COPIED: neither ExtendScript, QE, nor documented Premiere UXP exposes mask shapes, paths, feather, expansion, or mask keyframes, and masks are invisible to this bridge, so recreate or paste masks manually in Effect Controls. Time Remapping is excluded unless named in components.",
      parameters: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          source_node_id: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            description: "Node ID of the source timeline clip in the active sequence whose attributes are copied",
          },
          target_node_id: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            description: "Node ID of the target timeline clip in the active sequence that receives the attributes; must be on the same track type (video or audio) as the source",
          },
          components: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 256 },
            description: "Optional component display names or match names to copy (for example ['Motion', 'Opacity', 'Gaussian Blur']). Omit to copy every source component except Time Remapping.",
          },
          copy_keyframes: {
            type: "boolean",
            description: "Copy keyframes of animated source properties (default true). Key times keep their offset from each clip's in point. When false, animated source properties are reported in notCopied and left unchanged on the target.",
          },
          apply_missing_effects: {
            type: "boolean",
            description: "Apply source effects that the target lacks through the experimental legacy QE DOM before copying values (default true). When false, missing effects are reported in notCopied.",
          },
        },
        required: ["source_node_id", "target_node_id"],
      },
      handler: async (args: PasteClipAttributesArgs) => {
        const validationError = validatePasteClipAttributesArgs(args);
        if (validationError) return { success: false, error: validationError };
        const response = await sendCommand(buildPasteClipAttributesScript(args), bridgeOptions) as {
          success: boolean;
          error?: string;
          data?: { status?: string; summary?: Record<string, number> };
        };
        if (!response || !response.success || !response.data) return response;
        const status = response.data.status;
        if (status === "verified" || status === "committed_unverified") return response;
        const summary = response.data.summary ?? {};
        return {
          success: false,
          error:
            `paste_clip_attributes was ${status === "partial" ? "only partially applied" : "not applied"}: ` +
            `${summary.verified ?? 0} verified, ${summary.committedUnverified ?? 0} committed_unverified, ` +
            `${summary.failed ?? 0} failed, ${summary.notCopied ?? 0} not copied. ` +
            "Inspect data.properties and data.notCopied, and check Effect Controls before retrying. Re-running reuses components that already exist on the target instead of adding duplicates. Masks are never copied by this tool.",
          data: response.data,
        };
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
      operationalCapability: {
        backend: "local" as const,
        backends: ["local" as const],
        status: "unsupported" as const,
        minimumPremiereVersion: null,
        authority: "edit" as const,
        verificationBoundary: "static_metadata_only" as const,
        hostVerificationRequired: false,
        notes: ["Unavailable by design; this tool returns a local negative result and never contacts Premiere."],
      },
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
