(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpNextWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createNextWorkflowDefinitions(deps) {
    const events = deps.events;
    return {
      "events.list": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canUseEvents,
        handler: listEvents
      },
      "events.wait": {
        readOnly: true,
        minHostVersion: "25.6.0",
        probe: canUseEvents,
        handler: waitForEvents
      }
    };

    function canUseEvents() {
      return !!(events && typeof events.list === "function" && typeof events.wait === "function");
    }

    function listEvents(args) {
      assertOnlyKeys(args, ["afterRevision", "categories", "eventNames", "limit"]);
      return events.list(query(args, false));
    }

    function waitForEvents(args) {
      assertOnlyKeys(args, ["afterRevision", "categories", "eventNames", "limit", "timeoutMs"]);
      return events.wait(query(args, true));
    }
  }

  function query(args, allowTimeout) {
    const value = args || {};
    return {
      afterRevision: value.afterRevision == null ? 0 : integer(value.afterRevision, "afterRevision", 0, Number.MAX_SAFE_INTEGER),
      categories: tokenArray(value.categories, "categories"),
      eventNames: tokenArray(value.eventNames, "eventNames"),
      limit: value.limit == null ? 100 : integer(value.limit, "limit", 1, 256),
      timeoutMs: allowTimeout && value.timeoutMs != null ? integer(value.timeoutMs, "timeoutMs", 0, 60000) : 0
    };
  }

  function tokenArray(value, name) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 32) throw commandError("UXP_INVALID_ARGUMENT", name + " must contain at most 32 values");
    return value.map(function (item) {
      if (typeof item !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(item)) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " contains an invalid token");
      }
      return item;
    });
  }

  function integer(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw commandError("UXP_INVALID_ARGUMENT", name + " must be an integer between " + minimum + " and " + maximum);
    }
    return number;
  }

  function assertOnlyKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "arguments must be an object");
    for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw commandError("UXP_INVALID_ARGUMENT", "Unexpected argument: " + key);
  }

  function commandError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { createNextWorkflowDefinitions };
});
