// The command body is supplied through the local bridge. Keeping this host
// script minimal prevents unreviewed global helpers from persisting in AE.
function mcpAfterEffectsBridgePing() {
  return "pong";
}
