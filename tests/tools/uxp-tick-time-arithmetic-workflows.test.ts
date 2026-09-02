import { describe, expect, it, vi } from "vitest";
import { getUxpTickTimeArithmeticWorkflowTools } from "../../src/tools/uxp-tick-time-arithmetic-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

describe("public native TickTime arithmetic MCP tool", () => {
  it("uses a closed read-only schema and preserves canonical tick inputs", async () => {
    const request = vi.fn().mockResolvedValue({ result: { ticks: "3", seconds: 0 } });
    const tool = getUxpTickTimeArithmeticWorkflowTools({ request } as unknown as UxpWebSocketBridge).calculate_tick_time_uxp;
    expect(tool.parameters).toMatchObject({
      additionalProperties: false, required: ["operation", "base_ticks"],
      properties: { operation: { enum: ["add", "subtract", "multiply", "divide"] }, base_ticks: { pattern: "^(?:0|-?[1-9][0-9]{0,17})$" } },
    });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    await tool.handler({ operation: "add", base_ticks: "1", operand_ticks: "2" });
    await tool.handler({ operation: "multiply", base_ticks: "3", factor: 4 });
    expect(request).toHaveBeenNthCalledWith(1, "time.tickArithmetic.inspect", { operation: "add", baseTicks: "1", operandTicks: "2" });
    expect(request).toHaveBeenNthCalledWith(2, "time.tickArithmetic.inspect", { operation: "multiply", baseTicks: "3", factor: 4 });
  });
});
