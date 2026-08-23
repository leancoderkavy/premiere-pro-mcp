export const product = {
  name: "MCP for Adobe Premiere Pro",
  version: "1.12.2",
  releaseDate: "2026-08-22",
  coreToolCount: 288,
  defaultProfileToolCount: 286,
  connectedUxpToolCount: 336,
  nodeVersion: "20.19",
  premiereCompatibility: "2020–2026",
  uxpMinimumVersion: "25.6",
  downloads: {
    claudeBundle:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.12.2/premiere-pro-mcp-1.12.2.mcpb",
    signedCepConnector:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.12.2/MCPBridgeCEP.zxp",
    releaseNotes: "https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.12.2",
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
