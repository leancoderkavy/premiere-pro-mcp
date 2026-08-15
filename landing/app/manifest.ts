import type { MetadataRoute } from "next"

export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Premiere Pro MCP",
    short_name: "PP MCP",
    description:
      "Open-source MCP server for AI-assisted editing in Adobe Premiere Pro.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#09090b",
    icons: [
      {
        src: "/marketing/premiere-pro-mcp-mark-v1.png",
        sizes: "1254x1254",
        type: "image/png",
      },
    ],
  }
}
