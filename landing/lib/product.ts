export const product = {
  name: "Premiere Pro MCP",
  version: "1.11.3",
  releaseDate: "2026-08-18",
  coreToolCount: 285,
  defaultProfileToolCount: 283,
  connectedUxpToolCount: 332,
  nodeVersion: "20.19",
  premiereCompatibility: "2020–2026",
  uxpMinimumVersion: "25.6",
  downloads: {
    claudeBundle:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.11.3/premiere-pro-mcp-1.11.3.mcpb",
    signedCepConnector:
      "https://github.com/leancoderkavy/premiere-pro-mcp/releases/download/v1.11.3/MCPBridgeCEP.zxp",
    releaseNotes: "https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.11.3",
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
