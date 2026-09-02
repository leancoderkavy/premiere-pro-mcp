(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpObjectMaskAuditWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ObjectMaskUtils intentionally exposes only a yes/no answer.  This audit
  // makes that answer useful for bounded review without inventing a mask
  // count, location, quality, editability, tracking state, or render result.
  function createObjectMaskAuditWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const MAX_SEQUENCES = 64;
    const definitions = {
      "objectMask.audit": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canAuditObjectMasks,
        handler: auditObjectMasks
      }
    };

    function canAuditObjectMasks() {
      return !!(ppro && ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.ObjectMaskUtils && typeof ppro.ObjectMaskUtils.hasObjectMask === "function");
    }

    async function auditObjectMasks(args) {
      assertOnlyKeys(args, ["expectedProjectGuid", "sequenceIds"]);
      const requestedIds = requestedSequenceIds(args.sequenceIds);
      const project = await activeProject();
      const projectGuid = requiredGuid(project.guid, "active project GUID");
      if (args.expectedProjectGuid != null && requiredGuid(args.expectedProjectGuid, "expectedProjectGuid") !== projectGuid) {
        throw commandError("UXP_STALE_OBJECT_MASK_AUDIT", "The active project differs from expectedProjectGuid; inspect the current object-mask state again");
      }

      const projectHasObjectMask = objectMaskValue(project);
      const first = await targetSequences(project, requestedIds);
      const firstResults = first.map(function (entry) {
        return { id: entry.id, name: entry.name, hasObjectMask: objectMaskValue(entry.sequence) };
      });

      const activeAfter = await activeProject();
      if (requiredGuid(activeAfter.guid, "active project GUID after audit") !== projectGuid) {
        throw commandError("UXP_STALE_OBJECT_MASK_AUDIT", "The active project changed while object masks were being audited");
      }
      const second = await targetSequences(activeAfter, requestedIds);
      const secondResults = second.map(function (entry) {
        return { id: entry.id, name: entry.name, hasObjectMask: objectMaskValue(entry.sequence) };
      });
      const projectHasObjectMaskAfter = objectMaskValue(activeAfter);
      if (projectHasObjectMaskAfter !== projectHasObjectMask || !sameAudit(firstResults, secondResults)) {
        throw commandError("UXP_STALE_OBJECT_MASK_AUDIT", "The project, sequence identities, or object-mask results changed during the audit; retry");
      }

      const maskedSequenceCount = firstResults.filter(function (entry) { return entry.hasObjectMask; }).length;
      return {
        projectGuid,
        scope: requestedIds ? "explicit_sequences" : "all_project_sequences",
        projectHasObjectMask,
        sequenceCount: firstResults.length,
        maskedSequenceCount,
        sequences: firstResults,
        verificationBoundary: "bounded_project_and_sequence_object_mask_double_readback"
      };
    }

    async function activeProject() {
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      return project;
    }

    function requestedSequenceIds(value) {
      if (value == null) return null;
      if (!Array.isArray(value) || !value.length || value.length > MAX_SEQUENCES) {
        throw commandError("UXP_INVALID_ARGUMENT", "sequenceIds must contain 1-" + MAX_SEQUENCES + " exact sequence GUIDs");
      }
      const ids = value.map(function (entry, index) {
        return requiredGuid(entry, "sequenceIds[" + index + "]");
      });
      if (new Set(ids).size !== ids.length) throw commandError("UXP_INVALID_ARGUMENT", "sequenceIds must not contain duplicates");
      return ids.sort();
    }

    async function targetSequences(project, requestedIds) {
      const values = requestedIds ? await sequencesById(project, requestedIds) : await allSequences(project);
      const seen = new Set(), snapshots = [];
      for (let index = 0; index < values.length; index += 1) {
        const sequence = values[index];
        const id = requiredGuid(sequence && sequence.guid, "sequence GUID");
        if (seen.has(id)) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned duplicate sequence GUIDs during object-mask audit");
        seen.add(id);
        snapshots.push({ sequence, id, name: boundedName(sequence && sequence.name) });
      }
      snapshots.sort(function (left, right) { return left.id.localeCompare(right.id); });
      return snapshots;
    }

    async function allSequences(project) {
      if (typeof project.getSequences !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose documented project sequence enumeration");
      }
      const values = Array.from(await project.getSequences() || []);
      if (values.length > MAX_SEQUENCES) {
        throw commandError("UXP_PROJECT_TOO_LARGE", "Object-mask audit is capped at " + MAX_SEQUENCES + " sequences; pass at most " + MAX_SEQUENCES + " exact sequenceIds instead");
      }
      return values;
    }

    async function sequencesById(project, ids) {
      if (!ppro.Guid || typeof ppro.Guid.fromString !== "function" || typeof project.getSequence !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose documented exact sequence GUID lookup");
      }
      const values = [];
      for (let index = 0; index < ids.length; index += 1) {
        let sequence;
        try { sequence = await project.getSequence(ppro.Guid.fromString(ids[index])); } catch (_) { sequence = null; }
        if (!sequence || requiredGuid(sequence.guid, "resolved sequence GUID") !== ids[index]) {
          throw commandError("UXP_STALE_OBJECT_MASK_AUDIT", "A requested sequence no longer resolves to its exact GUID; retry the audit");
        }
        values.push(sequence);
      }
      return values;
    }

    function objectMaskValue(target) {
      let value;
      try { value = ppro.ObjectMaskUtils.hasObjectMask(target); } catch (error) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere could not report object-mask presence: " + (error && error.message || String(error)));
      }
      if (typeof value !== "boolean") throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned a non-boolean object-mask result");
      return value;
    }

    function sameAudit(left, right) {
      return left.length === right.length && left.every(function (entry, index) {
        const other = right[index];
        return other && entry.id === other.id && entry.name === other.name && entry.hasObjectMask === other.hasObjectMask;
      });
    }

    return definitions;
  }

  function assertOnlyKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "arguments must be an object");
    const unknown = Object.keys(value).find(function (key) { return !allowed.includes(key); });
    if (unknown) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown);
  }

  function requiredGuid(value, name) {
    let text = "";
    try { text = String(value && typeof value.toString === "function" ? value.toString() : value || ""); } catch (_) {}
    if (!text || text.length > 512) throw commandError("UXP_VERIFICATION_FAILED", name + " must be a bounded non-empty GUID");
    return text;
  }

  function boundedName(value) {
    const name = String(value == null ? "" : value);
    if (name.length > 255) throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an overlong sequence name");
    return name;
  }

  function commandError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createObjectMaskAuditWorkflowDefinitions };
});
