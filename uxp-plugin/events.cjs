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
  const MAX_ENCODE_JOBS = 64;
  const SAFE_DETAIL_KEYS = new Set([
    "state", "progress", "phase", "trackIndex", "mediaType", "attributed", "jobId"
  ]);

  // Snap events are notifications only.  Keep their host constants and the
  // public journal names in one small, testable mapping so neither event
  // payloads nor any unrecognized host event can cross the bridge.
  function createTimelineSnapEventDefinitions(snapEvent) {
    if (!snapEvent || typeof snapEvent !== "object") return [];
    return [
      ["timeline.snap.keyframe", snapEvent.EVENT_SNAP_TO_KEYFRAME],
      ["timeline.snap.trackItem", snapEvent.EVENT_SNAP_TO_TRACKITEM],
      ["timeline.snap.guides", snapEvent.EVENT_SNAP_TO_GUIDES],
      ["timeline.snap.razor.playhead", snapEvent.EVENT_SNAP_RAZOR_TO_PLAYHEAD],
      ["timeline.snap.razor.marker", snapEvent.EVENT_SNAP_RAZOR_TO_MARKER],
      ["timeline.snap.playhead.trackItemEdge", snapEvent.EVENT_SNAP_PLAYHEAD_TO_TRACKITEM_EDGE]
    ].filter(function (entry) {
      return typeof entry[1] === "string" && entry[1].length > 0;
    }).map(function (entry) {
      return {
        category: "timeline",
        name: entry[0],
        eventName: entry[1],
        stateInvalidating: false,
        coalesceKey: null
      };
    });
  }

  // These two root OperationCompleteEvent constants are not completion
  // attestations: one reports a clip's extend limit and the other reports an
  // effect drag-over. Keep them passive and redact the native event object.
  // Drag-over may be noisy, so retain only the most recent consecutive receipt.
  function createOperationBoundaryEventDefinitions(operationCompleteEvent) {
    if (!operationCompleteEvent || typeof operationCompleteEvent !== "object") return [];
    return [
      ["operation.clip.extend.reached", operationCompleteEvent.EVENT_CLIP_EXTEND_REACHED, null],
      ["operation.effect.drag.over", operationCompleteEvent.EVENT_EFFECT_DRAG_OVER, "operation.effect.drag.over"]
    ].filter(function (entry) {
      return typeof entry[1] === "string" && entry[1].length > 0;
    }).map(function (entry) {
      return {
        category: "operation",
        name: entry[0],
        eventName: entry[1],
        stateInvalidating: false,
        coalesceKey: entry[2]
      };
    });
  }

  function createEventJournal(options) {
    const value = options || {};
    const capacity = boundedInteger(value.capacity == null ? DEFAULT_CAPACITY : value.capacity, "capacity", 16, MAX_CAPACITY);
    const now = typeof value.now === "function" ? value.now : function () { return Date.now(); };
    const setTimer = typeof value.setTimer === "function" ? value.setTimer : setTimeout;
    const clearTimer = typeof value.clearTimer === "function" ? value.clearTimer : clearTimeout;
    const entries = [];
    const waiters = new Set();
    const jobs = new Map();
    const jobWaiters = new Set();
    let revision = 0;
    let dropped = 0;
    let evictedThroughRevision = 0;
    let jobSequence = 0;
    let unattributedEncoderEvents = 0;
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
        const evicted = entries.shift();
        if (evicted) evictedThroughRevision = Math.max(evictedThroughRevision, evicted.revision);
        dropped += 1;
      }
      settleWaiters();
      return publicEvent(event);
    }

    function recordHostEvent(input) {
      const value = Object.assign({}, input, { detail: Object.assign({}, input && input.detail) });
      let attributedJob = null;
      if (value.category === "encoder") {
        const candidates = Array.from(jobs.values()).filter(function (job) { return !job.terminal; });
        if (candidates.length === 1) {
          attributedJob = candidates[0];
          value.detail.attributed = true;
          value.detail.jobId = attributedJob.jobId;
        } else {
          value.detail.attributed = false;
          unattributedEncoderEvents += 1;
        }
      }
      const receipt = append(value);
      if (attributedJob && receipt) applyEncoderReceipt(attributedJob, receipt);
      return receipt;
    }

    function list(input) {
      const query = normalizeQuery(input);
      const oldestRevision = entries.length ? entries[0].revision : revision + 1;
      const overflow = query.afterRevision > 0 && query.afterRevision < evictedThroughRevision;
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
      if (immediate.events.length || immediate.overflow || query.timeoutMs === 0 || closed) {
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

    function beginEncodeJob(input) {
      if (closed) throw trackerError("UXP_ENCODE_TRACKER_CLOSED", "Encode receipt tracking is closed");
      const value = input || {};
      const operationId = value.operationId == null ? null : boundedToken(value.operationId, "operationId");
      const jobId = operationId || ("encode-" + now() + "-" + (++jobSequence));
      if (jobs.has(jobId)) return publicJob(jobs.get(jobId));
      pruneJobs();
      if (jobs.size >= MAX_ENCODE_JOBS) throw trackerError("UXP_ENCODE_TRACKER_FULL", "Encode receipt tracker is full");
      const timestamp = new Date(now()).toISOString();
      const job = {
        jobId,
        operationId,
        kind: boundedToken(value.kind || "unknown", "kind"),
        state: "submitting",
        progress: null,
        hostEvent: null,
        eventRevision: null,
        terminal: false,
        terminalReason: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      jobs.set(jobId, job);
      return publicJob(job);
    }

    function markEncodeAccepted(jobId) {
      const job = requiredJob(jobId);
      if (job.state === "submitting") updateJob(job, { state: "accepted" });
      return publicJob(job);
    }

    function markEncodeRejected(jobId, reason) {
      const job = requiredJob(jobId);
      updateJob(job, {
        state: "failed",
        terminal: true,
        terminalReason: boundedToken(reason || "host_rejected", "reason")
      });
      return publicJob(job);
    }

    function listEncodeJobs(input) {
      const value = input || {};
      const jobId = value.jobId == null ? null : boundedToken(value.jobId, "jobId");
      const limit = boundedInteger(value.limit == null ? 32 : value.limit, "limit", 1, MAX_ENCODE_JOBS);
      const values = jobId ? [requiredJob(jobId)] : Array.from(jobs.values()).slice(-limit).reverse();
      return {
        jobs: values.map(publicJob),
        count: values.length,
        unattributedEncoderEvents,
        correlation: "single-active-job-only"
      };
    }

    function waitForEncodeJob(input) {
      const value = input || {};
      const job = requiredJob(value.jobId);
      const timeoutMs = boundedInteger(value.timeoutMs == null ? 0 : value.timeoutMs, "timeoutMs", 0, MAX_WAIT_MS);
      if (job.terminal || timeoutMs === 0 || closed) {
        return Promise.resolve({ job: publicJob(job), timedOut: false, closed });
      }
      return new Promise(function (resolve) {
        const waiter = { jobId: job.jobId, resolve, timer: null };
        waiter.timer = setTimer(function () {
          jobWaiters.delete(waiter);
          resolve({ job: publicJob(requiredJob(waiter.jobId)), timedOut: true, closed });
        }, timeoutMs);
        jobWaiters.add(waiter);
      });
    }

    function settleWaiters() {
      for (const waiter of Array.from(waiters)) {
        const result = list(waiter.query);
        if (!result.events.length && !result.overflow) continue;
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
      for (const waiter of Array.from(jobWaiters)) {
        jobWaiters.delete(waiter);
        if (waiter.timer) clearTimer(waiter.timer);
        waiter.resolve({ job: publicJob(requiredJob(waiter.jobId)), timedOut: false, closed: true });
      }
    }

    function status() {
      return {
        capacity,
        size: entries.length,
        latestRevision: revision,
        oldestRevision: entries.length ? entries[0].revision : revision + 1,
        dropped,
        encodeJobs: jobs.size,
        unattributedEncoderEvents,
        closed
      };
    }

    function applyEncoderReceipt(job, receipt) {
      const states = {
        "encoder.queued": { state: "queued" },
        "encoder.progress": { state: "rendering", progress: receipt.detail.progress == null ? job.progress : receipt.detail.progress },
        "encoder.complete": { state: "completed", progress: 1, terminal: true, terminalReason: "completed" },
        "encoder.error": { state: "failed", terminal: true, terminalReason: "encoder_error" },
        "encoder.cancelled": { state: "cancelled", terminal: true, terminalReason: "cancelled" }
      };
      updateJob(job, Object.assign({ hostEvent: receipt.name, eventRevision: receipt.revision }, states[receipt.name] || {}));
    }

    function updateJob(job, values) {
      Object.assign(job, values, { updatedAt: new Date(now()).toISOString() });
      if (!job.terminal) return;
      for (const waiter of Array.from(jobWaiters)) {
        if (waiter.jobId !== job.jobId) continue;
        jobWaiters.delete(waiter);
        if (waiter.timer) clearTimer(waiter.timer);
        waiter.resolve({ job: publicJob(job), timedOut: false, closed });
      }
    }

    function requiredJob(jobId) {
      const id = boundedToken(jobId, "jobId");
      const job = jobs.get(id);
      if (!job) throw trackerError("UXP_ENCODE_JOB_NOT_FOUND", "Encode job receipt was not found");
      return job;
    }

    function pruneJobs() {
      if (jobs.size < MAX_ENCODE_JOBS) return;
      const terminal = Array.from(jobs.values()).filter(function (job) { return job.terminal; });
      if (terminal.length) jobs.delete(terminal[0].jobId);
    }

    return {
      append, recordHostEvent, list, wait, close, status,
      beginEncodeJob, markEncodeAccepted, markEncodeRejected, listEncodeJobs, waitForEncodeJob
    };
  }

  function publicJob(job) {
    return {
      jobId: job.jobId,
      operationId: job.operationId,
      kind: job.kind,
      state: job.state,
      progress: job.progress,
      hostEvent: job.hostEvent,
      eventRevision: job.eventRevision,
      terminal: job.terminal,
      terminalReason: job.terminalReason,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      verificationBoundary: job.terminal ? "encoder_terminal_event_only" : "encoder_host_acceptance_or_event"
    };
  }

  function trackerError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
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

  return { createEventJournal, createTimelineSnapEventDefinitions, createOperationBoundaryEventDefinitions };
});
