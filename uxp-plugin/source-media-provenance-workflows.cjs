(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpSourceMediaProvenanceWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // This command intentionally resolves only the explicitly requested item
  // twice. It must not invoke media-path getters while traversing unrelated
  // project items because those values are sensitive and are outside the
  // caller's bounded target.
  function createSourceMediaProvenanceWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    return {
      "source.provenance.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "26.3.0",
        probe: canInspectSourceProvenance,
        handler: inspectSourceProvenance
      }
    };

    function canInspectSourceProvenance() {
      return !!(
        ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.FolderItem && typeof ppro.FolderItem.cast === "function" &&
        ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function"
      );
    }

    async function inspectSourceProvenance(args) {
      const request = requestFrom(args);
      const first = await sourceProvenanceSnapshot(request);
      const second = await sourceProvenanceSnapshot(request);
      if (!sameSnapshot(first, second)) {
        throw commandError(
          "UXP_STALE_SOURCE_PROVENANCE",
          "The active project, requested project item, or requested provenance path changed while it was being inspected"
        );
      }
      return second;
    }

    function requestFrom(args) {
      assertOnlyKeys(args, ["projectItemId", "includeMediaFilePath", "includeOriginatingProjectPath"]);
      const includeMediaFilePath = optionalBoolean(args.includeMediaFilePath, "includeMediaFilePath");
      const includeOriginatingProjectPath = optionalBoolean(args.includeOriginatingProjectPath, "includeOriginatingProjectPath");
      if (!includeMediaFilePath && !includeOriginatingProjectPath) {
        throw commandError(
          "UXP_PATH_DISCLOSURE_REQUIRED",
          "Set includeMediaFilePath or includeOriginatingProjectPath to true before a native path is read"
        );
      }
      return {
        projectItemId: requiredText(args.projectItemId, "projectItemId", 512),
        includeMediaFilePath,
        includeOriginatingProjectPath
      };
    }

    async function sourceProvenanceSnapshot(request) {
      const project = await activeProject();
      const projectGuid = requiredGuid(project.guid, "active project GUID");
      const rootItem = await requiredMethod(project, "getRootItem")();
      const projectItem = await findProjectItem(rootItem, request.projectItemId);
      if (!projectItem) {
        throw commandError("UXP_TARGET_NOT_FOUND", "projectItemId does not identify an item in the active project");
      }
      const resolvedId = requiredText(requiredMethod(projectItem, "getId")(), "resolved project item ID", 512);
      if (resolvedId !== request.projectItemId) {
        throw commandError("UXP_STALE_SOURCE_PROVENANCE", "The resolved project item ID changed during provenance inspection");
      }
      const clipProjectItem = castClipProjectItem(projectItem);
      const readbackId = requiredText(requiredMethod(projectItem, "getId")(), "resolved project item ID", 512);
      if (readbackId !== request.projectItemId) {
        throw commandError("UXP_STALE_SOURCE_PROVENANCE", "The resolved project item changed before provenance getters ran");
      }
      const snapshot = { projectGuid, projectItemId: readbackId };
      if (request.includeMediaFilePath) {
        snapshot.mediaFilePath = boundedPath(await requiredMethod(clipProjectItem, "getMediaFilePath")(), "media file path");
      }
      if (request.includeOriginatingProjectPath) {
        snapshot.originatingProjectPath = boundedPath(await requiredMethod(clipProjectItem, "getOriginatingProjectPath")(), "originating project path");
      }
      return snapshot;
    }

    async function activeProject() {
      if (!ppro.Project || typeof ppro.Project.getActiveProject !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere project APIs are unavailable");
      }
      const project = await ppro.Project.getActiveProject();
      if (!project) throw commandError("UXP_NO_ACTIVE_PROJECT", "No active project");
      return project;
    }

    async function findProjectItem(rootItem, expectedId) {
      if (!rootItem || typeof rootItem !== "object") {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid project root item");
      }
      const pending = [rootItem];
      const visited = new Set();
      while (pending.length) {
        const candidate = pending.shift();
        const candidateId = requiredText(requiredMethod(candidate, "getId")(), "project item ID", 512);
        if (visited.has(candidateId)) continue;
        visited.add(candidateId);
        if (visited.size > 4096) {
          throw commandError("UXP_TARGET_TOO_LARGE", "The active project has more than 4096 reachable project items");
        }
        if (candidateId === expectedId) return candidate;
        const folder = castFolderItem(candidate);
        if (!folder) continue;
        const children = await requiredMethod(folder, "getItems")();
        if (!Array.isArray(children)) {
          throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid project folder collection");
        }
        if (children.length > 4096 || pending.length + children.length + visited.size > 4096) {
          throw commandError("UXP_TARGET_TOO_LARGE", "The active project has more than 4096 reachable project items");
        }
        for (let index = 0; index < children.length; index += 1) pending.push(children[index]);
      }
      return null;
    }

    function castFolderItem(projectItem) {
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere FolderItem APIs are unavailable");
      }
      try {
        return ppro.FolderItem.cast(projectItem) || null;
      } catch (_) {
        return null;
      }
    }

    function castClipProjectItem(projectItem) {
      if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere ClipProjectItem APIs are unavailable");
      }
      try {
        const clip = ppro.ClipProjectItem.cast(projectItem);
        if (clip) return clip;
      } catch (_) {
        // A non-clip project item cannot expose the two documented provenance
        // getters. Preserve that distinction instead of treating it as absent.
      }
      throw commandError("UXP_TARGET_NOT_MEDIA", "projectItemId does not identify a media-backed ClipProjectItem");
    }
  }

  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw commandError("UXP_INVALID_ARGUMENT", (name || "args") + " must be an object");
    }
  }
  function assertOnlyKeys(value, allowed) {
    assertObject(value, "args");
    const unknown = Object.keys(value).filter(function (key) { return !allowed.includes(key); });
    if (unknown.length) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown[0]);
  }
  function optionalBoolean(value, name) {
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a boolean");
    return value;
  }
  function requiredMethod(value, method) {
    if (!value || typeof value[method] !== "function") {
      throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose " + method + " for this target");
    }
    return value[method].bind(value);
  }
  function requiredText(value, name, maximum) {
    if (typeof value !== "string" || !value.length || value.length > maximum || value.indexOf("\u0000") !== -1) {
      throw commandError("UXP_VERIFICATION_FAILED", name + " is unavailable or invalid");
    }
    return value;
  }
  function requiredGuid(value, name) {
    let guid = "";
    try { guid = value == null ? "" : typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { guid = ""; }
    return requiredText(guid, name, 128);
  }
  function boundedPath(value, name) {
    if (typeof value !== "string" || value.length > 4096 || value.indexOf("\u0000") !== -1) {
      throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an invalid " + name);
    }
    return value;
  }
  function sameSnapshot(left, right) {
    return left.projectGuid === right.projectGuid &&
      left.projectItemId === right.projectItemId &&
      left.mediaFilePath === right.mediaFilePath &&
      left.originatingProjectPath === right.originatingProjectPath;
  }
  function commandError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createSourceMediaProvenanceWorkflowDefinitions };
});
