import type { MetadataRoute } from "next"

export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/mcp", "/health"],
      },
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: ["/mcp", "/health"],
      },
    ],
    sitemap: "https://premiere-pro-mcp.fly.dev/sitemap.xml",
    host: "https://premiere-pro-mcp.fly.dev",
  }
}
