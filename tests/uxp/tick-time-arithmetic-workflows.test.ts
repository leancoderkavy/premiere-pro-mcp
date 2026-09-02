import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const Commands = require("../../uxp-plugin/commands.cjs");
const Protocol = require("../../uxp-plugin/protocol.cjs");
const TICKS_PER_SECOND = 254_016_000_000n;

function tickTimeHost() {
  const makeTickTime = (ticks: bigint) => ({
    get ticks() { return ticks.toString(); },
    get seconds() { return Number(ticks) / Number(TICKS_PER_SECOND); },
    add: vi.fn((other: { ticks: string }) => makeTickTime(ticks + BigInt(other.ticks))),
    subtract: vi.fn((other: { ticks: string }) => makeTickTime(ticks - BigInt(other.ticks))),
    multiply: vi.fn((factor: number) => makeTickTime(ticks * BigInt(factor))),
    divide: vi.fn((factor: number) => makeTickTime(ticks / BigInt(factor))),
  });
  const createWithTicks = vi.fn((ticks: string) => makeTickTime(BigInt(ticks)));
  const ppro = {
    TickTime: { createWithTicks },
    Project: { getActiveProject: vi.fn(async () => null) },
  };
  return { createWithTicks, registry: Commands.createCommandRegistry({ ppro, Protocol }) };
}

describe("bounded documented UXP TickTime arithmetic", () => {
  it("advertises the independent read-only native TickTime command", async () => {
    const value = tickTimeHost();
    await expect(value.registry.capabilities()).resolves.toMatchObject({ commands: {
      "time.tickArithmetic.inspect": { supported: true, readOnly: true, minHostVersion: "25.6.0", targetCapabilityProbe: "invocation" },
    } });
  });

  it("returns native TickTime add and subtract readback without project access", async () => {
    const value = tickTimeHost();
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "add", baseTicks: "254016000000", operandTicks: "127008000000",
    })).resolves.toEqual({
      operation: "add", base: { ticks: "254016000000", seconds: 1 }, operand: { ticks: "127008000000", seconds: 0.5 },
      result: { ticks: "381024000000", seconds: 1.5 }, verificationBoundary: "native_tick_time_value_readback",
      limitations: ["This is pure native TickTime arithmetic over caller-supplied ticks; it does not align frames, infer timecode, inspect Premiere project state, or prove a licensed host."],
    });
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "subtract", baseTicks: "254016000000", operandTicks: "381024000000",
    })).resolves.toMatchObject({ result: { ticks: "-127008000000", seconds: -0.5 } });
    expect(value.createWithTicks).toHaveBeenCalled();
  });

  it("uses integer multiply and divide factors while rejecting ambiguous or unsafe inputs", async () => {
    const value = tickTimeHost();
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "multiply", baseTicks: "127008000000", factor: 3,
    })).resolves.toMatchObject({ factor: 3, result: { ticks: "381024000000", seconds: 1.5 } });
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "divide", baseTicks: "381024000000", factor: 3,
    })).resolves.toMatchObject({ factor: 3, result: { ticks: "127008000000", seconds: 0.5 } });
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "add", baseTicks: "01", operandTicks: "1",
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "multiply", baseTicks: "1", factor: 0,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
    await expect(value.registry.dispatch("time.tickArithmetic.inspect", {
      operation: "divide", baseTicks: "1", operandTicks: "1", factor: 2,
    })).rejects.toMatchObject({ code: "UXP_INVALID_ARGUMENT" });
  });
});
