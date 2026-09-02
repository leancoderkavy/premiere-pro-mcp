(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTrackItemMutationLocks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A slide modifies the target plus both immediate neighbours. Use the same
  // track-level tail for slips and slides so an operation on one of those
  // neighbours cannot bypass the reviewed snapshot while a slide is pending.
  function createTrackItemMutationLocks() {
    const tails = new Map();

    function withTrackMutationLock(key, operation) {
      const previous = tails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(function (resolve) { release = resolve; });
      const tail = previous.catch(function () { return undefined; }).then(function () { return gate; });
      tails.set(key, tail);
      return previous.catch(function () { return undefined; }).then(operation).finally(function () {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      });
    }

    return { withTrackMutationLock };
  }

  return { createTrackItemMutationLocks };
});
