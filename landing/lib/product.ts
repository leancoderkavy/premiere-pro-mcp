import published from "./published-release.json"
export { default as sourceCatalog } from "./source-catalog.json"

// Public downloads and software metadata describe the inspected published package.
// Development counts are generated separately from the current source catalog.
export const product = {
  name: "MCP for Adobe Premiere Pro",
  version: published.version,
  releaseDate: published.releaseDate,
  coreToolCount: published.coreTools,
  defaultProfileToolCount: published.defaultProfileTools,
  connectedUxpToolCount: published.defaultProfileWithUxpTools,
  uxpAdditionalToolCount: published.uxpAdditionalTools,
  nodeVersion: published.nodeVersion,
  premiereCompatibility: published.premiereVersions,
  uxpMinimumVersion: published.uxpMinimumVersion,
  downloads: {
    claudeBundle:
      `https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v${published.version}/premiere-pro-mcp-${published.version}.mcpb`,
    signedCepConnector:
      `https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v${published.version}/MCPBridgeCEP.zxp`,
    releaseNotes: `https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v${published.version}`,
  },
  links: {
    repository: "https://github.com/leancoderkavy/premiere-pro-mcp",
    npm: "https://www.npmjs.com/package/premiere-pro-mcp",
    issues: "https://github.com/leancoderkavy/premiere-pro-mcp/issues",
    readme: "https://github.com/leancoderkavy/premiere-pro-mcp#readme",
  },
} as const

export const safeFirstPrompt =
  "Safely check my Premiere connection with verify_premiere_connection. Make no changes."

export const projectIntakePreviewPrompt =
  "Evaluate this open Premiere project against our approved intake template. Return the path-redacted report and proposed organization actions. Do not change Premiere or persist the template."
