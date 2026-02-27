// Host-side ExtendScript (runs in Premiere Pro's ExtendScript engine)
// This file can contain ExtendScript helper functions that are always available.
// The main execution happens dynamically via CSInterface.evalScript() from main.js.

function mcpBridgePing() {
  return "pong";
}
