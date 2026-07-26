(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTranscript = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_TRANSCRIPT_JSON_BYTES = 5 * 1024 * 1024;

  function utf8ByteLength(value) {
    return unescape(encodeURIComponent(value)).length;
  }

  function parseTranscriptJSON(raw) {
    if (typeof raw !== "string" || raw.length === 0) throw new Error("transcript JSON must be a non-empty string");
    if (utf8ByteLength(raw) > MAX_TRANSCRIPT_JSON_BYTES) throw new Error("transcript JSON exceeds the 5 MB command limit");
    try { return JSON.parse(raw); } catch (error) { throw new Error("transcript JSON is invalid: " + error.message); }
  }

  function searchTranscriptJSON(raw, query, options) {
    const document = parseTranscriptJSON(raw);
    const term = typeof query === "string" ? query.trim() : "";
    if (!term) throw new Error("query must be a non-empty string");
    const settings = options || {};
    const caseSensitive = settings.caseSensitive === true;
    const requestedLimit = Number(settings.maxResults == null ? 50 : settings.maxResults);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
      throw new Error("maxResults must be an integer between 1 and 500");
    }
    const needle = caseSensitive ? term : term.toLocaleLowerCase();
    const matches = [];
    const collectionLimit = requestedLimit + 1;
    function visit(value, path) {
      if (matches.length >= collectionLimit) return;
      if (typeof value === "string") {
        const haystack = caseSensitive ? value : value.toLocaleLowerCase();
        let from = 0;
        while (matches.length < collectionLimit) {
          const index = haystack.indexOf(needle, from);
          if (index < 0) break;
          const contextStart = Math.max(0, index - 80);
          const contextEnd = Math.min(value.length, index + term.length + 80);
          matches.push({ path, index, text: value, context: value.slice(contextStart, contextEnd) });
          from = index + Math.max(needle.length, 1);
        }
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length && matches.length < collectionLimit; i += 1) visit(value[i], path + "[" + i + "]");
      } else if (value && typeof value === "object") {
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length && matches.length < collectionLimit; i += 1) {
          const key = keys[i];
          visit(value[key], path ? path + "." + key : key);
        }
      }
    }
    visit(document, "$");
    return { query: term, caseSensitive, matches: matches.slice(0, requestedLimit), limited: matches.length > requestedLimit };
  }

  function versionAtLeast(version, minimum) {
    const current = String(version || "").split(".").map(Number);
    const required = String(minimum).split(".").map(Number);
    for (let i = 0; i < Math.max(current.length, required.length); i += 1) {
      const left = Number.isFinite(current[i]) ? current[i] : 0;
      const right = Number.isFinite(required[i]) ? required[i] : 0;
      if (left !== right) return left > right;
    }
    return true;
  }

  function matchingClipCandidate(item, itemId, wantedId, wantedName, cast) {
    const idMatch = !!wantedId && itemId === wantedId;
    const nameMatch = !wantedId && !!wantedName && item && item.name === wantedName;
    if (!idMatch && !nameMatch) return { matched: false, clip: null };
    try {
      return { matched: true, clip: cast(item) };
    } catch (error) {
      if (idMatch) throw error;
      return { matched: true, clip: null };
    }
  }

  async function probeTranscriptExport(exportTranscript) {
    const json = await exportTranscript();
    return typeof json === "string" && json.length > 0;
  }

  return {
    MAX_TRANSCRIPT_JSON_BYTES,
    parseTranscriptJSON,
    searchTranscriptJSON,
    versionAtLeast,
    matchingClipCandidate,
    probeTranscriptExport
  };
});
