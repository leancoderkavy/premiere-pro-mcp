(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTranscriptImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_IMPORT_BYTES = 24 * 1024;
  const MAX_SNAPSHOT_BYTES = 1024 * 1024;
  const MAX_PROJECT_ITEMS = 512;
  const MAX_PROJECT_DEPTH = 16;

  function createTranscriptImportRuntime(deps) {
    const ppro = deps.ppro, transcript = deps.TranscriptSupport, Protocol = deps.Protocol;
    const importTails = new Map();

    function commandError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    function assertObject(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "args must be an object");
    }

    function assertOnlyKeys(value, allowed) {
      const unknown = Object.keys(value).find(function (key) { return !allowed.includes(key); });
      if (unknown) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown);
    }

    function requiredString(value, name, maximum) {
      if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-empty string of at most " + maximum + " characters");
      }
      return value;
    }

    function exactGuid(value, name) {
      const guid = requiredString(value, name, 512);
      if (guid === "[object Object]") throw commandError("UXP_INVALID_ARGUMENT", name + " must be a readable GUID string");
      return guid;
    }

    function expectedRevision(value) {
      if (value === null) return null;
      if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        throw commandError("UXP_INVALID_ARGUMENT", "expectedTranscriptRevision must be a sha256 revision or null");
      }
      return value;
    }

    function validateImportArgs(args) {
      assertObject(args);
      assertOnlyKeys(args, ["projectItemId", "expectedProjectGuid", "expectedTranscriptRevision", "json", "confirmDestructive", "operationId"]);
      if (args.confirmDestructive !== true) {
        throw commandError("UXP_CONFIRMATION_REQUIRED", "confirmDestructive: true is required to replace a source transcript");
      }
      if (typeof args.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(args.operationId)) {
        throw commandError("UXP_INVALID_ARGUMENT", "operationId must be 1-128 safe characters");
      }
      const json = requiredString(args.json, "json", MAX_IMPORT_BYTES);
      if (transcript.utf8ByteLength(json) > MAX_IMPORT_BYTES) {
        throw commandError("UXP_INVALID_ARGUMENT", "json exceeds the 24 KiB transcript-import bridge limit");
      }
      try { transcript.parseTranscriptJSON(json); } catch (error) {
        throw commandError("UXP_INVALID_ARGUMENT", error && error.message ? error.message : "json is not valid transcript JSON");
      }
      return {
        projectItemId: requiredString(args.projectItemId, "projectItemId", 512),
        expectedProjectGuid: exactGuid(args.expectedProjectGuid, "expectedProjectGuid"),
        expectedTranscriptRevision: expectedRevision(args.expectedTranscriptRevision),
        json,
      };
    }

    function guidString(value) {
      if (value == null) return "";
      try { return typeof value.toString === "function" ? String(value.toString()) : String(value); } catch (_) { return ""; }
    }

    async function projectItemId(item) {
      if (!item || typeof item.getId !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Project-item identity access is unavailable");
      const value = await item.getId();
      if (value == null || String(value) === "") throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an unreadable project-item ID");
      return String(value);
    }

    function folderValue(item) {
      if (!item || typeof item.getItems !== "function") return null;
      if (!ppro.FolderItem || typeof ppro.FolderItem.cast !== "function") return item;
      try { return ppro.FolderItem.cast(item) || null; } catch (_) { return null; }
    }

    function clipValue(item) {
      if (!ppro.ClipProjectItem || typeof ppro.ClipProjectItem.cast !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "ClipProjectItem casting is unavailable");
      }
      try { return ppro.ClipProjectItem.cast(item) || null; } catch (_) { return null; }
    }

    async function resolveTarget(input) {
      if (!ppro.Project || typeof ppro.Project.getActiveProject !== "function") {
        throw commandError("UXP_COMMAND_UNAVAILABLE", "Active-project access is unavailable");
      }
      const project = await ppro.Project.getActiveProject();
      if (!project || typeof project.getRootItem !== "function") throw commandError("UXP_NO_ACTIVE_PROJECT", "No readable active project");
      const projectGuid = guidString(project.guid);
      if (!projectGuid || projectGuid === "[object Object]") throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned an unreadable active-project GUID");
      if (projectGuid !== input.expectedProjectGuid) throw commandError("UXP_STALE_TRANSCRIPT", "The active project no longer matches expectedProjectGuid");
      const root = await project.getRootItem();
      const queue = [{ item: root, depth: 0 }];
      let inspected = 0;
      while (queue.length) {
        const current = queue.shift(), folder = folderValue(current.item);
        if (!folder) continue;
        const children = Array.from(await folder.getItems() || []);
        for (let index = 0; index < children.length; index += 1) {
          inspected += 1;
          if (inspected > MAX_PROJECT_ITEMS) {
            throw commandError("UXP_PROJECT_TOO_LARGE", "Transcript target lookup exceeds " + MAX_PROJECT_ITEMS + " project items");
          }
          const child = children[index], childId = await projectItemId(child);
          if (childId === input.projectItemId) {
            const clip = clipValue(child);
            if (!clip) throw commandError("UXP_TARGET_NOT_FOUND", "The requested project item is not a media clip");
            return { project, projectGuid, clip, projectItemId: childId };
          }
          const childFolder = folderValue(child);
          if (childFolder) {
            if (current.depth >= MAX_PROJECT_DEPTH) {
              throw commandError("UXP_PROJECT_TOO_LARGE", "Transcript target lookup exceeds project-folder depth " + MAX_PROJECT_DEPTH);
            }
            queue.push({ item: childFolder, depth: current.depth + 1 });
          }
        }
      }
      throw commandError("UXP_TARGET_NOT_FOUND", "projectItemId was not found in the active project");
    }

    async function transcriptSnapshot(clip) {
      let hasTranscript = ppro.Transcript.hasTranscript(clip);
      if (hasTranscript && typeof hasTranscript.then === "function") hasTranscript = await hasTranscript;
      if (!hasTranscript) return { hasTranscript: false, transcriptRevision: null };
      const json = await ppro.Transcript.exportToJSON(clip);
      if (typeof json !== "string" || !json) throw commandError("UXP_VERIFICATION_FAILED", "Premiere reports a transcript but did not export readable JSON");
      if (transcript.utf8ByteLength(json) > MAX_SNAPSHOT_BYTES) {
        throw commandError("UXP_RESULT_TOO_LARGE", "Transcript readback exceeds the 1 MiB bounded snapshot limit");
      }
      try { transcript.parseTranscriptJSON(json); } catch (error) {
        throw commandError("UXP_VERIFICATION_FAILED", error && error.message ? error.message : "Premiere returned invalid transcript JSON");
      }
      return { hasTranscript: true, transcriptRevision: transcript.transcriptRevision(json) };
    }

    function requireExpectedSnapshot(snapshot, expected) {
      if (!snapshot.hasTranscript && expected === null) return;
      if (snapshot.hasTranscript && snapshot.transcriptRevision === expected) return;
      throw commandError("UXP_STALE_TRANSCRIPT", "The source transcript no longer matches expectedTranscriptRevision");
    }

    function serialize(key, work) {
      const previous = importTails.get(key) || Promise.resolve();
      const next = previous.catch(function () { return undefined; }).then(work);
      importTails.set(key, next);
      return next.finally(function () { if (importTails.get(key) === next) importTails.delete(key); });
    }

    function operation(verified, boundary, evidence) {
      if (!Protocol || typeof Protocol.operationSemantics !== "function") return undefined;
      return Protocol.operationSemantics({
        mutatesProject: true,
        verificationStatus: verified ? "verified" : "committed_unverified",
        verificationBoundary: boundary,
        verificationEvidence: evidence,
        undoSupported: true,
        undoLabel: "Import transcript",
        transactionActionGroup: true,
        cancellationSupported: true
      });
    }

    async function importTranscript(args) {
      const input = validateImportArgs(args);
      return serialize(input.expectedProjectGuid + ":" + input.projectItemId, async function () {
        const beforeTarget = await resolveTarget(input), before = await transcriptSnapshot(beforeTarget.clip);
        requireExpectedSnapshot(before, input.expectedTranscriptRevision);

        // Resolve and snapshot a second time immediately before action creation.
        // The per-owner queue prevents a different operation ID in this panel
        // from passing the same stale preflight concurrently.
        const actionTarget = await resolveTarget(input), actionSnapshot = await transcriptSnapshot(actionTarget.clip);
        requireExpectedSnapshot(actionSnapshot, input.expectedTranscriptRevision);
        let textSegments;
        try { textSegments = ppro.Transcript.importFromJSON(input.json); } catch (error) {
          throw commandError("UXP_INVALID_ARGUMENT", error && error.message ? error.message : "Premiere rejected transcript JSON");
        }
        if (!textSegments) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create transcript text segments");
        if (typeof actionTarget.project.lockedAccess !== "function" || typeof actionTarget.project.executeTransaction !== "function") {
          throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere transaction APIs are unavailable for transcript import");
        }
        let committed = false;
        actionTarget.project.lockedAccess(function () {
          const action = ppro.Transcript.createImportTextSegmentsAction(textSegments, actionTarget.clip);
          if (!action) throw commandError("UXP_ACTION_REJECTED", "Premiere did not create a transcript import action");
          committed = actionTarget.project.executeTransaction(function (compoundAction) {
            if (!compoundAction || typeof compoundAction.addAction !== "function" || compoundAction.addAction(action) === false) {
              throw commandError("UXP_ACTION_REJECTED", "Premiere rejected the transcript import action");
            }
          }, "Import transcript");
        });
        if (!committed) throw commandError("UXP_TRANSACTION_FAILED", "Premiere did not commit the transcript import transaction");

        const requestedRevision = transcript.transcriptRevision(input.json);
        try {
          const afterTarget = await resolveTarget(input), after = await transcriptSnapshot(afterTarget.clip);
          const verified = after.hasTranscript && after.transcriptRevision === requestedRevision;
          return {
            committed: true,
            verified,
            projectGuid: actionTarget.projectGuid,
            projectItemId: actionTarget.projectItemId,
            before,
            requestedTranscriptRevision: requestedRevision,
            after,
            outcome: verified ? "verified" : "committed_unverified",
            verificationBoundary: verified ? "transcript_export_exact_readback" : "transcript_transaction_commit_with_readback_mismatch",
            undoLabel: "Import transcript",
            operation: operation(
              verified,
              verified ? "transcript_export_exact_readback" : "transcript_transaction_commit_with_readback_mismatch",
              verified
                ? [{ type: "transcript_export_sha256", expected: requestedRevision, actual: after.transcriptRevision }]
                : [{ type: "transcript_export_sha256", expected: requestedRevision, actual: after.transcriptRevision }]
            )
          };
        } catch (error) {
          return {
            committed: true,
            verified: false,
            projectGuid: actionTarget.projectGuid,
            projectItemId: actionTarget.projectItemId,
            before,
            requestedTranscriptRevision: requestedRevision,
            after: null,
            outcome: "committed_unverified",
            verificationBoundary: "transcript_transaction_commit_with_readback_unavailable",
            readbackError: error && error.message ? error.message : String(error),
            undoLabel: "Import transcript",
            operation: operation(false, "transcript_transaction_commit_with_readback_unavailable", [{
              type: "readback_error", message: error && error.message ? error.message : String(error)
            }])
          };
        }
      });
    }

    function canImportTranscript() {
      return !!(ppro.Project && typeof ppro.Project.getActiveProject === "function" && ppro.Transcript
        && typeof ppro.Transcript.hasTranscript === "function" && typeof ppro.Transcript.exportToJSON === "function"
        && typeof ppro.Transcript.importFromJSON === "function" && typeof ppro.Transcript.createImportTextSegmentsAction === "function"
        && ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function");
    }

    return { canImportTranscript, importTranscript, constants: { MAX_IMPORT_BYTES, MAX_SNAPSHOT_BYTES, MAX_PROJECT_ITEMS, MAX_PROJECT_DEPTH } };
  }

  return { createTranscriptImportRuntime };
});
