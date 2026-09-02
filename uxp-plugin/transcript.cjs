(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTranscript = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_TRANSCRIPT_JSON_BYTES = 5 * 1024 * 1024;

  function utf8ByteLength(value) {
    let bytes = 0;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  // This stays local to the panel instead of assuming Web Crypto is exposed by
  // every supported Premiere UXP runtime. It uses the same UTF-8 replacement
  // behavior as Node's sha256 revision returned by get_clip_transcript_uxp.
  function utf8Bytes(value) {
    const text = String(value), bytes = [];
    for (let index = 0; index < text.length; index += 1) {
      let code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00;
          index += 1;
        } else code = 0xfffd;
      } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return bytes;
  }

  function rightRotate(value, bits) { return (value >>> bits) | (value << (32 - bits)); }

  function sha256Hex(value) {
    const bytes = utf8Bytes(value), bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 0x100000000), low = bitLength >>> 0;
    bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
    bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);
    const words = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    for (let offset = 0; offset < bytes.length; offset += 64) {
      const schedule = new Array(64);
      for (let index = 0; index < 16; index += 1) {
        const position = offset + index * 4;
        schedule[index] = ((bytes[position] << 24) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const previous = schedule[index - 15], earlier = schedule[index - 2];
        const sigma0 = rightRotate(previous, 7) ^ rightRotate(previous, 18) ^ (previous >>> 3);
        const sigma1 = rightRotate(earlier, 17) ^ rightRotate(earlier, 19) ^ (earlier >>> 10);
        schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
      }
      let a = words[0], b = words[1], c = words[2], d = words[3], e = words[4], f = words[5], g = words[6], h = words[7];
      for (let index = 0; index < 64; index += 1) {
        const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const choice = (e & f) ^ (~e & g);
        const first = (h + sigma1 + choice + constants[index] + schedule[index]) >>> 0;
        const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const second = (sigma0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
      }
      words[0] = (words[0] + a) >>> 0; words[1] = (words[1] + b) >>> 0;
      words[2] = (words[2] + c) >>> 0; words[3] = (words[3] + d) >>> 0;
      words[4] = (words[4] + e) >>> 0; words[5] = (words[5] + f) >>> 0;
      words[6] = (words[6] + g) >>> 0; words[7] = (words[7] + h) >>> 0;
    }
    return words.map(function (word) { return (word >>> 0).toString(16).padStart(8, "0"); }).join("");
  }

  function transcriptRevision(raw) { return "sha256:" + sha256Hex(raw); }

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
    utf8ByteLength,
    parseTranscriptJSON,
    searchTranscriptJSON,
    transcriptRevision,
    versionAtLeast,
    matchingClipCandidate,
    probeTranscriptExport
  };
});
