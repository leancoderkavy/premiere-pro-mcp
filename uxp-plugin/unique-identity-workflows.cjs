(function attachUniqueIdentityWorkflows(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PremiereMcpUniqueIdentityWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createUniqueIdentityWorkflows() {
  "use strict";

  const MAX_PROJECT_ITEMS = 512;
  const MAX_TOKEN_LENGTH = 512;

  function createUniqueIdentityWorkflowDefinitions(deps) {
    const ppro = deps && deps.ppro;
    if (!ppro) throw new Error("createUniqueIdentityWorkflowDefinitions requires ppro");
    const definitions = {
      "object.uniqueIdentity.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canInspectUniqueIdentity,
        handler: inspectUniqueIdentity
      }
    };

    function canInspectUniqueIdentity() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" &&
        ppro.UniqueSerializeable && typeof ppro.UniqueSerializeable.cast === "function");
    }

    async function inspectUniqueIdentity(args) {
      const input = normalizeInput(args);
      const firstSnapshot = await readSnapshot(ppro, input);
      if (input.expectedProjectGuid && firstSnapshot.projectGuid !== input.expectedProjectGuid) {
        throw createError("UXP_STALE_UNIQUE_IDENTITY", "The active project changed before unique identity inspection.");
      }
      if (input.expectedUniqueId && firstSnapshot.target.uniqueId !== input.expectedUniqueId) {
        throw createError("UXP_STALE_UNIQUE_IDENTITY", "The requested target no longer has the expected unique identity.");
      }
      const secondSnapshot = await readSnapshot(ppro, input);
      if (!snapshotsMatch(firstSnapshot, secondSnapshot)) {
        throw createError("UXP_STALE_UNIQUE_IDENTITY", "The requested target changed during unique identity inspection.");
      }
      return Object.assign({}, secondSnapshot, {
        verificationBoundary: "bounded_unique_serializable_double_readback"
      });
    }

    return definitions;
  }

  function normalizeInput(args) {
    const value = args || {};
    if (!isPlainObject(value)) throw createError("UXP_INVALID_ARGUMENT", "Expected an object argument.");
    const allowedKeys = ["projectItemId", "sequenceGuid", "expectedProjectGuid", "expectedUniqueId"];
    Object.keys(value).forEach(function rejectUnknownKey(key) {
      if (allowedKeys.indexOf(key) === -1) throw createError("UXP_INVALID_ARGUMENT", "Unsupported argument: " + key + ".");
    });
    const projectItemId = optionalToken(value.projectItemId, "projectItemId");
    const sequenceGuid = optionalToken(value.sequenceGuid, "sequenceGuid");
    if ((projectItemId ? 1 : 0) + (sequenceGuid ? 1 : 0) !== 1) {
      throw createError("UXP_INVALID_ARGUMENT", "Provide exactly one of projectItemId or sequenceGuid.");
    }
    return {
      projectItemId: projectItemId,
      sequenceGuid: sequenceGuid,
      expectedProjectGuid: optionalToken(value.expectedProjectGuid, "expectedProjectGuid"),
      expectedUniqueId: optionalToken(value.expectedUniqueId, "expectedUniqueId")
    };
  }

  async function readSnapshot(ppro, input) {
    const project = await activeProject(ppro);
    const projectGuid = await requiredGuid(project.guid, "active project GUID");
    const target = input.sequenceGuid
      ? await sequenceTarget(ppro, project, input.sequenceGuid)
      : await projectItemTarget(ppro, project, input.projectItemId);
    return { projectGuid: projectGuid, target: target };
  }

  async function activeProject(ppro) {
    if (!ppro.Project || typeof ppro.Project.getActiveProject !== "function") {
      throw createError("UXP_COMMAND_UNAVAILABLE", "Project.getActiveProject is unavailable.");
    }
    const project = await ppro.Project.getActiveProject();
    if (!project) throw createError("UXP_NO_ACTIVE_PROJECT", "No active project is available.");
    return project;
  }

  async function sequenceTarget(ppro, project, requestedGuid) {
    if (!ppro.Guid || typeof ppro.Guid.fromString !== "function" || typeof project.getSequence !== "function") {
      throw createError("UXP_COMMAND_UNAVAILABLE", "Sequence lookup is unavailable.");
    }
    let sequence;
    try {
      sequence = await project.getSequence(ppro.Guid.fromString(requestedGuid));
    } catch (error) {
      throw createError("UXP_TARGET_NOT_FOUND", "The requested sequence could not be resolved.");
    }
    if (!sequence) throw createError("UXP_TARGET_NOT_FOUND", "The requested sequence could not be resolved.");
    const sequenceGuid = await requiredGuid(sequence.guid, "resolved sequence GUID");
    if (sequenceGuid !== requestedGuid) {
      throw createError("UXP_TARGET_NOT_FOUND", "The requested sequence could not be resolved.");
    }
    return {
      kind: "sequence",
      sequenceGuid: sequenceGuid,
      uniqueId: await uniqueIdFor(ppro, sequence)
    };
  }

  async function projectItemTarget(ppro, project, requestedProjectItemId) {
    if (typeof project.getRootItem !== "function") {
      throw createError("UXP_COMMAND_UNAVAILABLE", "Project.getRootItem is unavailable.");
    }
    const rootItem = await project.getRootItem();
    if (!rootItem) throw createError("UXP_TARGET_NOT_FOUND", "The active project has no root item.");
    const item = await findProjectItem(rootItem, requestedProjectItemId);
    if (!item) throw createError("UXP_TARGET_NOT_FOUND", "The requested project item could not be resolved.");
    return {
      kind: "project_item",
      projectItemId: requestedProjectItemId,
      uniqueId: await uniqueIdFor(ppro, item)
    };
  }

  async function findProjectItem(rootItem, requestedProjectItemId) {
    const queue = [rootItem];
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      visited += 1;
      if (visited > MAX_PROJECT_ITEMS) {
        throw createError("UXP_PROJECT_TOO_LARGE", "Project item lookup exceeded the " + MAX_PROJECT_ITEMS + " item limit.");
      }
      if (!current || typeof current.getId !== "function") {
        throw createError("UXP_COMMAND_UNAVAILABLE", "Project item ID lookup is unavailable.");
      }
      if (requiredToken(await current.getId(), "project item ID") === requestedProjectItemId) return current;
      if (typeof current.getItems === "function") {
        const children = await current.getItems();
        if (!Array.isArray(children)) {
          throw createError("UXP_VERIFICATION_FAILED", "Project item children were not returned as an array.");
        }
        Array.prototype.push.apply(queue, children);
      }
    }
    return null;
  }

  async function uniqueIdFor(ppro, target) {
    if (!ppro.UniqueSerializeable || typeof ppro.UniqueSerializeable.cast !== "function") {
      throw createError("UXP_COMMAND_UNAVAILABLE", "UniqueSerializeable.cast is unavailable.");
    }
    let serializable;
    try {
      serializable = ppro.UniqueSerializeable.cast(target);
    } catch (error) {
      throw createError("UXP_COMMAND_UNAVAILABLE", "The requested target cannot be serialized uniquely.");
    }
    if (!serializable || typeof serializable.getUniqueID !== "function") {
      throw createError("UXP_COMMAND_UNAVAILABLE", "UniqueSerializeable.getUniqueID is unavailable.");
    }
    return requiredGuid(await serializable.getUniqueID(), "unique identity");
  }

  async function requiredGuid(value, label) {
    if (!value || typeof value.toString !== "function") {
      throw createError("UXP_VERIFICATION_FAILED", "Expected a " + label + ".");
    }
    return requiredToken(await value.toString(), label);
  }

  function snapshotsMatch(first, second) {
    if (first.projectGuid !== second.projectGuid || first.target.kind !== second.target.kind || first.target.uniqueId !== second.target.uniqueId) return false;
    return first.target.kind === "sequence"
      ? first.target.sequenceGuid === second.target.sequenceGuid
      : first.target.projectItemId === second.target.projectItemId;
  }

  function optionalToken(value, label) {
    return value === undefined || value === null ? undefined : requiredToken(value, label);
  }

  function requiredToken(value, label) {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_TOKEN_LENGTH) {
      throw createError("UXP_INVALID_ARGUMENT", "Expected " + label + " to be a non-empty string up to " + MAX_TOKEN_LENGTH + " characters.");
    }
    return value;
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createUniqueIdentityWorkflowDefinitions: createUniqueIdentityWorkflowDefinitions };
});
