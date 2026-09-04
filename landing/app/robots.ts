import type { MetadataRoute } from "next"

export const dynamic = "force-static"

const aiCrawlerUserAgents = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/mcp", "/health"],
      },
      {
        userAgent: aiCrawlerUserAgents,
        allow: "/",
        disallow: ["/mcp", "/health"],
      },
    ],
    sitemap: "https://premiere-pro-mcp.com/sitemap.xml",
    host: "https://premiere-pro-mcp.com",
  }
}
