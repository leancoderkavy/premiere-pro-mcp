import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export async function setProjectItemStartTime(args: { item_id: string; start_seconds: number }, bridgeOptions: BridgeOptions) {
  if (typeof args.item_id !== "string" || !args.item_id.trim()) return { success: false, error: "item_id must be non-empty" };
  if (!Number.isFinite(args.start_seconds)) return { success: false, error: "start_seconds must be finite" };
  const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var ticks = __secondsToTicks(${args.start_seconds}).toString();
          item.setStartTime(ticks);
          var observedStart = NaN;
          try { observedStart = Number(item.startTime().seconds); } catch (startReadError) {}
          if (!isFinite(observedStart) || Math.abs(observedStart - ${args.start_seconds}) > 0.001) {
            return __error("Premiere did not apply the start time; read back " + observedStart + " s.");
          }
          return __result({ set: true, verified: true, item: item.name, startSeconds: observedStart });
  `);
  return sendCommand(script, bridgeOptions);
}
