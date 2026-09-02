export const product = {
  name: "MCP for Adobe Premiere Pro",
  version: "1.14.6",
  releaseDate: "2026-09-02",
  coreToolCount: 328,
  defaultProfileToolCount: 326,
  connectedUxpToolCount: 399,
  nodeVersion: "20.19",
  premiereCompatibility: "2020–2026",
  uxpMinimumVersion: "25.6",
  downloads: {
    claudeBundle:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.14.6/premiere-pro-mcp-1.14.6.mcpb",
    signedCepConnector:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.14.6/MCPBridgeCEP.zxp",
    releaseNotes: "https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.14.6",
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
