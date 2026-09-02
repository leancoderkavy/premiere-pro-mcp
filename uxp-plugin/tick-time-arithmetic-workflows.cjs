(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpTickTimeArithmeticWorkflows = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Keep this utility intentionally separate from frame alignment. It accepts
  // already-quantized Premiere ticks and returns only TickTime's native value
  // readback; it does not create a FrameRate, accept seconds, or inspect a
  // sequence, track, clip, or project.
  function createTickTimeArithmeticWorkflowDefinitions(deps) {
    const ppro = deps.ppro;
    const definitions = {
      "time.tickArithmetic.inspect": {
        readOnly: true,
        targetCapabilityProbe: true,
        minHostVersion: "25.6.0",
        probe: canUseTickArithmetic,
        handler: inspectTickArithmetic
      }
    };

    function canUseTickArithmetic() {
      return !!(ppro && ppro.TickTime && typeof ppro.TickTime.createWithTicks === "function");
    }

    async function inspectTickArithmetic(args) {
      assertOnlyKeys(args, ["operation", "baseTicks", "operandTicks", "factor"]);
      const operation = enumValue(args.operation, "operation", ["add", "subtract", "multiply", "divide"]);
      const baseTicks = canonicalTicks(args.baseTicks, "baseTicks");
      const base = createTickTime(baseTicks, "baseTicks");
      let operand = null, result;
      if (operation === "add" || operation === "subtract") {
        if (args.factor !== undefined) throw commandError("UXP_INVALID_ARGUMENT", "factor is only allowed for multiply or divide");
        operand = createTickTime(canonicalTicks(args.operandTicks, "operandTicks"), "operandTicks");
        const method = operation === "add" ? "add" : "subtract";
        if (typeof base.value[method] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose TickTime." + method);
        result = base.value[method](operand.value);
      } else {
        if (args.operandTicks !== undefined) throw commandError("UXP_INVALID_ARGUMENT", "operandTicks is only allowed for add or subtract");
        const factor = boundedFactor(args.factor, operation === "divide" ? "divisor" : "factor");
        const method = operation === "multiply" ? "multiply" : "divide";
        if (typeof base.value[method] !== "function") throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere does not expose TickTime." + method);
        result = base.value[method](factor);
        operand = { factor };
      }
      return {
        operation,
        base: readTickTime(base.value, "base"),
        ...(operation === "add" || operation === "subtract" ? { operand: readTickTime(operand.value, "operand") } : { factor: operand.factor }),
        result: readTickTime(result, "result"),
        verificationBoundary: "native_tick_time_value_readback",
        limitations: ["This is pure native TickTime arithmetic over caller-supplied ticks; it does not align frames, infer timecode, inspect Premiere project state, or prove a licensed host."]
      };
    }

    function createTickTime(ticks, name) {
      let value;
      try { value = ppro.TickTime.createWithTicks(ticks); } catch (_) { value = null; }
      if (!value) throw commandError("UXP_COMMAND_UNAVAILABLE", "Premiere rejected " + name + " while constructing TickTime");
      return { value };
    }

    function readTickTime(value, name) {
      if (!value || typeof value !== "object") throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned no TickTime for " + name);
      const ticks = canonicalTicks(value.ticks, name + ".ticks");
      const seconds = Number(value.seconds);
      if (!Number.isFinite(seconds) || Math.abs(seconds) > 1_000_000_000) {
        throw commandError("UXP_VERIFICATION_FAILED", "Premiere returned invalid " + name + ".seconds");
      }
      return { ticks, seconds };
    }

    function canonicalTicks(value, name) {
      if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]{0,17})$/.test(value)) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be a canonical signed tick integer with at most 18 digits");
      }
      return value;
    }
    function boundedFactor(value, name) {
      if (!Number.isInteger(value) || value < -1000000 || value > 1000000 || value === 0) {
        throw commandError("UXP_INVALID_ARGUMENT", name + " must be a non-zero integer from -1000000 through 1000000");
      }
      return value;
    }
    function enumValue(value, name, allowed) {
      if (!allowed.includes(value)) throw commandError("UXP_INVALID_ARGUMENT", name + " must be one of " + allowed.join(", "));
      return value;
    }
    function assertOnlyKeys(value, allowed) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw commandError("UXP_INVALID_ARGUMENT", "arguments must be an object");
      const unknown = Object.keys(value).find(function (key) { return !allowed.includes(key); });
      if (unknown) throw commandError("UXP_INVALID_ARGUMENT", "Unknown argument: " + unknown);
    }
    function commandError(code, message) { const error = new Error(message); error.code = code; return error; }

    return definitions;
  }

  return { createTickTimeArithmeticWorkflowDefinitions };
});
