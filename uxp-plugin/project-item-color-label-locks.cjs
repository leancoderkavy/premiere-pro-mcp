(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpProjectItemColorLabelLocks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // A source item's color label is project-global: the same item can appear on
  // multiple timeline tracks or sequences. Keep every bridge color-label
  // action for that item behind one tail so a second operation cannot build an
  // action from a label snapshot that the first operation has already changed.
  function createProjectItemColorLabelLocks() {
    const tails = new Map();

    function withProjectItemColorLabelLock(key, operation) {
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

    return { withProjectItemColorLabelLock };
  }

  return { createProjectItemColorLabelLocks };
});
