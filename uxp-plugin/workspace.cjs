(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpWorkspace = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIG_FILE = "workspace-access.json";

  function workspaceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function parseAbsolutePath(value, label) {
    if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.indexOf("\0") !== -1) {
      throw workspaceError("UXP_INVALID_ARGUMENT", label + " must be a non-empty absolute path of at most 4096 characters");
    }
    const original = value.trim();
    const windowsInput = /^[A-Za-z]:[\\/]/.test(original) || /^\\\\/.test(original);
    const slashed = windowsInput ? original.replace(/\\/g, "/") : original;
    const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed);
    const unc = windowsInput && /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(slashed);
    const posix = !drive && !unc && slashed.charAt(0) === "/";
    if (!drive && !unc && !posix) {
      throw workspaceError("UXP_INVALID_ARGUMENT", label + " must be absolute");
    }
    const prefix = drive ? drive[1].toUpperCase() + ":" : unc ? "//" + unc[1] + "/" + unc[2] : "";
    const remainder = drive ? drive[2] : unc ? (unc[3] || "") : slashed.slice(1);
    const parts = [];
    for (const part of remainder.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw workspaceError("UXP_PATH_OUTSIDE_WORKSPACE", label + " escapes its filesystem root");
        parts.pop();
        continue;
      }
      if ((drive || unc) && (/[. ]$/.test(part) || part.indexOf(":") !== -1 || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
        throw workspaceError("UXP_INVALID_ARGUMENT", label + " contains a Windows-ambiguous path segment");
      }
      parts.push(part);
    }
    const normalized = prefix + "/" + parts.join("/");
    return {
      normalized: normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized,
      comparison: (drive || unc ? normalized.toLowerCase() : normalized),
      kind: drive ? "windows" : unc ? "unc" : "posix",
      depth: parts.length
    };
  }

  function isContained(rootPath, candidatePath, allowRoot) {
    const root = parseAbsolutePath(rootPath, "workspace root");
    const candidate = parseAbsolutePath(candidatePath, "path");
    if (root.kind !== candidate.kind) return false;
    if (candidate.comparison === root.comparison) return !!allowRoot;
    return candidate.comparison.indexOf(root.comparison + "/") === 0;
  }

  function validateLoopbackBridgeUrl(value) {
    let url;
    try { url = new URL(value); } catch (_) {
      throw workspaceError("UXP_INVALID_BRIDGE_URL", "Bridge URL is invalid");
    }
    if (url.protocol !== "ws:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
      url.pathname !== "/uxp" || url.username || url.password || url.hash) {
      throw workspaceError("UXP_INVALID_BRIDGE_URL", "Bridge URL must be ws://127.0.0.1:<port>/uxp or ws://localhost:<port>/uxp");
    }
    url.search = "";
    return url;
  }

  function createWorkspaceBroker(deps) {
    const fs = deps && deps.fs;
    let rootEntry = null;
    let persistentToken = null;
    let initialized = false;

    function nativePathFor(entry) {
      if (entry && typeof entry.nativePath === "string" && entry.nativePath) return entry.nativePath;
      if (entry && fs && typeof fs.getNativePath === "function") return fs.getNativePath(entry);
      return "";
    }

    async function dataFolder() {
      if (!fs || typeof fs.getDataFolder !== "function") {
        throw workspaceError("UXP_WORKSPACE_UNAVAILABLE", "UXP persistent storage is unavailable");
      }
      return fs.getDataFolder();
    }

    async function readConfiguration() {
      try {
        const folder = await dataFolder();
        const file = await folder.getEntry(CONFIG_FILE);
        const parsed = JSON.parse(await file.read());
        if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.persistentToken !== "string") return null;
        return parsed;
      } catch (_) {
        return null;
      }
    }

    async function writeConfiguration(token) {
      const folder = await dataFolder();
      const file = await folder.createFile(CONFIG_FILE, { overwrite: true });
      await file.write(JSON.stringify({ schemaVersion: 1, persistentToken: token }));
    }

    async function deleteConfiguration() {
      try {
        const folder = await dataFolder();
        const file = await folder.getEntry(CONFIG_FILE);
        if (file && typeof file.delete === "function") await file.delete();
      } catch (_) {}
    }

    async function initialize() {
      if (initialized) return status();
      initialized = true;
      const stored = await readConfiguration();
      if (!stored || !fs || typeof fs.getEntryForPersistentToken !== "function") return status();
      try {
        const entry = await fs.getEntryForPersistentToken(stored.persistentToken);
        if (entry && entry.isFolder && nativePathFor(entry)) {
          rootEntry = entry;
          persistentToken = stored.persistentToken;
        }
      } catch (_) {
        await deleteConfiguration();
      }
      return status();
    }

    async function requestRoot() {
      if (!fs || typeof fs.getFolder !== "function" || typeof fs.createPersistentToken !== "function") {
        throw workspaceError("UXP_WORKSPACE_UNAVAILABLE", "This UXP runtime cannot request persistent folder access");
      }
      const entry = await fs.getFolder();
      const nativePath = nativePathFor(entry);
      if (!entry || !entry.isFolder || !nativePath) {
        throw workspaceError("UXP_WORKSPACE_NOT_SELECTED", "No workspace folder was selected");
      }
      if (parseAbsolutePath(nativePath, "workspace root").depth < 1) {
        throw workspaceError("UXP_WORKSPACE_TOO_BROAD", "Choose a project subfolder instead of a filesystem or share root");
      }
      const token = await fs.createPersistentToken(entry);
      if (typeof token !== "string" || !token) {
        throw workspaceError("UXP_WORKSPACE_UNAVAILABLE", "Premiere did not return a persistent workspace token");
      }
      await writeConfiguration(token);
      rootEntry = entry;
      persistentToken = token;
      initialized = true;
      return status();
    }

    async function revoke() {
      rootEntry = null;
      persistentToken = null;
      initialized = true;
      await deleteConfiguration();
      return status();
    }

    function status() {
      return {
        configured: !!rootEntry,
        accessMode: "request",
        rootName: rootEntry && typeof rootEntry.name === "string" ? rootEntry.name : null,
        persistent: !!persistentToken,
        pathDisclosure: "redacted"
      };
    }

    function assertPathAllowed(value, options) {
      const label = options && options.label || "path";
      const kind = options && options.kind || "file";
      const rootPath = nativePathFor(rootEntry);
      if (!rootEntry || !rootPath) {
        throw workspaceError("UXP_WORKSPACE_REQUIRED", "Choose an approved workspace folder in the MCP Bridge panel before using " + label);
      }
      const candidate = parseAbsolutePath(value, label);
      if (!isContained(rootPath, candidate.normalized, kind === "directory")) {
        throw workspaceError("UXP_PATH_OUTSIDE_WORKSPACE", label + " must stay inside the approved workspace folder");
      }
      return candidate.normalized;
    }

    return { initialize, requestRoot, revoke, status, assertPathAllowed };
  }

  return { createWorkspaceBroker, parseAbsolutePath, isContained, validateLoopbackBridgeUrl, workspaceError };
});
