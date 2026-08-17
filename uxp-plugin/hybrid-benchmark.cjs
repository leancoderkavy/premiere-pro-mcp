(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpHybridBenchmark = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORKLOAD_ID = "weighted-energy-v1";
  const DEFAULT_ADDON = "premiere-mcp-benchmark.uxpaddon";

  function run(options) {
    const input = options || {};
    assertOnlyKeys(input, [
      "sampleCount", "warmupCount", "iterations", "inputLength", "seed",
      "addonName", "loadAddon", "requireAddon", "now", "readMemory"
    ]);
    const sampleCount = boundedInteger(input.sampleCount == null ? 30 : input.sampleCount, "sampleCount", 5, 200);
    const warmupCount = boundedInteger(input.warmupCount == null ? 3 : input.warmupCount, "warmupCount", 0, 20);
    const iterations = boundedInteger(input.iterations == null ? 4 : input.iterations, "iterations", 1, 50);
    const inputLength = boundedInteger(input.inputLength == null ? 131072 : input.inputLength, "inputLength", 1024, 1048576);
    const seed = boundedInteger(input.seed == null ? 1337 : input.seed, "seed", 1, 2147483646);
    const now = typeof input.now === "function" ? input.now : monotonicNow;
    const readMemory = typeof input.readMemory === "function" ? input.readMemory : defaultMemoryReader;
    const data = deterministicInput(inputLength, seed);
    const js = measure(function () { return weightedEnergy(data, iterations); }, sampleCount, warmupCount, now, readMemory);
    const addon = loadAddon(input);
    let native = null, checksumMatch = null;
    if (addon.loaded) {
      if (!addon.value || typeof addon.value.runBenchmarkKernel !== "function") {
        throw benchmarkError("UXP_HYBRID_CONTRACT_MISMATCH", "The addon must export runBenchmarkKernel(Float64Array, iterations)");
      }
      native = measure(function () {
        const value = Number(addon.value.runBenchmarkKernel(data, iterations));
        if (!Number.isFinite(value)) throw benchmarkError("UXP_HYBRID_INVALID_RESULT", "The native benchmark returned a non-finite checksum");
        return value;
      }, sampleCount, warmupCount, now, readMemory);
      checksumMatch = sameChecksum(js.checksum, native.checksum);
    }
    if (input.requireAddon === true && !addon.loaded) {
      throw benchmarkError("UXP_HYBRID_ADDON_REQUIRED", addon.error || "The benchmark addon was not available");
    }
    return {
      schemaVersion: 1,
      workloadId: WORKLOAD_ID,
      configuration: { sampleCount, warmupCount, iterations, inputLength, seed },
      addon: { name: addon.name, loaded: addon.loaded, error: addon.error },
      javascript: js,
      native,
      checksumMatch,
      promotionEligible: false,
      promotionBoundary: "Run the cross-platform evidence verifier; this local result alone cannot enable a hybrid addon."
    };
  }

  function weightedEnergy(values, iterations) {
    let checksum = 0;
    for (let pass = 0; pass < iterations; pass += 1) {
      let energy = 0, crossings = 0, previous = values[0];
      for (let i = 0; i < values.length; i += 1) {
        const sample = values[i];
        energy += sample * sample * ((i & 15) + 1);
        if ((sample < 0) !== (previous < 0)) crossings += 1;
        previous = sample;
      }
      checksum += energy / values.length + crossings * 0.000001 + pass * 0.000000001;
    }
    return checksum;
  }

  function deterministicInput(length, seed) {
    const values = new Float64Array(length);
    let state = seed;
    for (let i = 0; i < length; i += 1) {
      state = state * 16807 % 2147483647;
      values[i] = state / 1073741823.5 - 1;
    }
    return values;
  }

  function measure(workload, sampleCount, warmupCount, now, readMemory) {
    for (let i = 0; i < warmupCount; i += 1) workload();
    const beforeBytes = safeMemory(readMemory), samples = [];
    let checksum = null;
    for (let i = 0; i < sampleCount; i += 1) {
      const startedAt = Number(now());
      checksum = Number(workload());
      const finishedAt = Number(now());
      const elapsed = finishedAt - startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0) throw benchmarkError("UXP_HYBRID_INVALID_CLOCK", "Benchmark clock must be monotonic");
      samples.push(elapsed);
    }
    const afterBytes = safeMemory(readMemory);
    return {
      sampleCount,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      minMs: Math.min.apply(Math, samples),
      maxMs: Math.max.apply(Math, samples),
      checksum,
      memory: {
        beforeBytes,
        afterBytes,
        deltaBytes: beforeBytes == null || afterBytes == null ? null : afterBytes - beforeBytes,
        boundary: "runtime_heap_snapshot_if_available"
      }
    };
  }

  function loadAddon(options) {
    const name = typeof options.addonName === "string" && options.addonName
      ? options.addonName
      : DEFAULT_ADDON;
    if (!/^[A-Za-z0-9._-]{1,128}\.uxpaddon$/.test(name)) {
      return { name, loaded: false, value: null, error: "addonName must be a simple .uxpaddon filename" };
    }
    const loader = typeof options.loadAddon === "function" ? options.loadAddon : defaultAddonLoader;
    try { return { name, loaded: true, value: loader(name), error: null }; }
    catch (error) { return { name, loaded: false, value: null, error: error && error.message || String(error) }; }
  }

  function defaultAddonLoader(name) {
    if (typeof require !== "function") throw new Error("CommonJS addon loading is unavailable");
    return require(name);
  }

  function monotonicNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
    return Date.now();
  }

  function defaultMemoryReader() {
    if (typeof performance !== "undefined" && performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)) {
      return performance.memory.usedJSHeapSize;
    }
    return null;
  }

  function safeMemory(reader) {
    try {
      const value = reader();
      return Number.isFinite(value) && value >= 0 ? Number(value) : null;
    } catch (_) { return null; }
  }

  function percentile(values, quantile) {
    const sorted = values.slice().sort(function (left, right) { return left - right; });
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
    return sorted[index];
  }

  function sameChecksum(left, right) {
    return Number.isFinite(left) && Number.isFinite(right) &&
      Math.abs(left - right) <= Math.max(1e-9, Math.abs(left) * 1e-10);
  }

  function boundedInteger(value, name, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw benchmarkError("UXP_HYBRID_INVALID_ARGUMENT", name + " must be an integer between " + minimum + " and " + maximum);
    }
    return number;
  }

  function assertOnlyKeys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw benchmarkError("UXP_HYBRID_INVALID_ARGUMENT", "options must be an object");
    for (const key of Object.keys(value)) if (allowed.indexOf(key) === -1) throw benchmarkError("UXP_HYBRID_INVALID_ARGUMENT", "Unexpected option: " + key);
  }

  function benchmarkError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return { WORKLOAD_ID, run, weightedEnergy, deterministicInput, percentile, sameChecksum };
});
