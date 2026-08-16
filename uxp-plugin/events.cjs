(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CAPACITY = 512;
  const MAX_CAPACITY = 2048;
  const MAX_WAIT_MS = 60000;
  const MAX_RESULTS = 256;
  const SAFE_DETAIL_KEYS = new Set([
    "state", "progress", "phase", "trackIndex", "mediaType", "attributed", "jobId"
  ]);

  function createEventJournal(options) {
    const value = options || {};
    const capacity = boundedInteger(value.capacity == null ? DEFAULT_CAPACITY : value.capacity, "capacity", 16, MAX_CAPACITY);
    const now = typeof value.now === "function" ? value.now : function () { return Date.now(); };
    const setTimer = typeof value.setTimer === "function" ? value.setTimer : setTimeout;
    const clearTimer = typeof value.clearTimer === "function" ? value.clearTimer : clearTimeout;
    const entries = [];
    const waiters = new Set();
    let revision = 0;
    let dropped = 0;
    let closed = false;

    function append(input) {
      if (closed) return null;
      const event = normalizeEvent(input, ++revision, now());
      const previous = entries.length ? entries[entries.length - 1] : null;
      if (event.coalesceKey && previous && previous.coalesceKey === event.coalesceKey) {
        event.coalesced = (previous.coalesced || 0) + 1;
        entries[entries.length - 1] = event;
      } else {
        entries.push(event);
      }
      while (entries.length > capacity) {
        entries.shift();
        dropped += 1;
      }
      settleWaiters();
      return publicEvent(event);
    }

    function list(input) {
      const query = normalizeQuery(input);
      const oldestRevision = entries.length ? entries[0].revision : revision + 1;
      const overflow = query.afterRevision > 0 && query.afterRevision < oldestRevision - 1;
      const matching = entries.filter(function (event) {
        return event.revision > query.afterRevision && matches(event, query);
      }).slice(0, query.limit).map(publicEvent);
      return {
        latestRevision: revision,
        oldestRevision,
        dropped,
        overflow,
        timedOut: false,
        events: matching
      };
    }

    function wait(input) {
      const query = normalizeQuery(input);
      const immediate = list(query);
      if (immediate.events.length || query.timeoutMs === 0 || closed) {
        return Promise.resolve(Object.assign(immediate, { closed }));
      }
      return new Promise(function (resolve) {
        const waiter = { query, resolve, timer: null };
        waiter.timer = setTimer(function () {
          waiters.delete(waiter);
          resolve(Object.assign(list(query), { timedOut: true, closed }));
        }, query.timeoutMs);
        waiters.add(waiter);
      });
    }

    function settleWaiters() {
      for (const waiter of Array.from(waiters)) {
        const result = list(waiter.query);
        if (!result.events.length) continue;
        waiters.delete(waiter);
        if (waiter.timer) clearTimer(waiter.timer);
        waiter.resolve(Object.assign(result, { closed: false }));
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      for (const waiter of Array.from(waiters)) {
        waiters.delete(waiter);
        if (waiter.timer) clearTimer(waiter.timer);
        waiter.resolve(Object.assign(list(waiter.query), { closed: true }));
      }
    }

    function status() {
      return {
        capacity,
        size: entries.length,
        latestRevision: revision,
        oldestRevision: entries.length ? entries[0].revision : revision + 1,
        dropped,
        closed
      };
    }

    return { append, list, wait, close, status };
  }

  function normalizeEvent(input, revision, timestamp) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("event must be an object");
    const category = boundedToken(input.category, "category");
    const name = boundedToken(input.name, "name");
    const coalesceKey = input.coalesceKey == null ? null : boundedToken(input.coalesceKey, "coalesceKey");
    return {
      revision,
      category,
      name,
      receivedAt: new Date(timestamp).toISOString(),
      detail: safeDetail(input.detail),
      coalesceKey,
      coalesced: 0
    };
  }

  function normalizeQuery(input) {
    const value = input || {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("event query must be an object");
    return {
      afterRevision: boundedInteger(value.afterRevision == null ? 0 : value.afterRevision, "afterRevision", 0, Number.MAX_SAFE_INTEGER),
      categories: tokenList(value.categories, "categories"),
      eventNames: tokenList(value.eventNames, "eventNames"),
      limit: boundedInteger(value.limit == null ? 100 : value.limit, "limit", 1, MAX_RESULTS),
      timeoutMs: boundedInteger(value.timeoutMs == null ? 0 : value.timeoutMs, "timeoutMs", 0, MAX_WAIT_MS)
    };
  }

  function matches(event, query) {
    return (!query.categories.length || query.categories.indexOf(event.category) !== -1)
      && (!query.eventNames.length || query.eventNames.indexOf(event.name) !== -1);
  }

  function safeDetail(value) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("event detail must be an object");
    const result = {};
    for (const key of Object.keys(value)) {
      if (!SAFE_DETAIL_KEYS.has(key)) continue;
      const item = value[key];
      if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) result[key] = item;
      else if (typeof item === "string") result[key] = item.slice(0, 128);
    }
    return result;
  }

  function tokenList(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 32) throw new Error(name + " must be an array of at most 32 tokens");
    return value.map(function (item) { return boundedToken(item, name); });
  }

  function boundedToken(value, name) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      throw new Error(name + " must be a 1-128 character token");
    }
    return value;
  }

  function boundedInteger(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(name + " must be an integer between " + minimum + " and " + maximum);
    }
    return number;
  }

  function publicEvent(event) {
    return {
      revision: event.revision,
      category: event.category,
      name: event.name,
      receivedAt: event.receivedAt,
      detail: Object.assign({}, event.detail),
      coalesced: event.coalesced || 0
    };
  }

  return { createEventJournal };
});
