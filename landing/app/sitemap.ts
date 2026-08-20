import type { MetadataRoute } from "next"

export const dynamic = "force-static"

const lastModified = new Date("2026-08-19")

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://premiere-pro-mcp.com/",
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://premiere-pro-mcp.com/docs/",
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: "https://premiere-pro-mcp.com/blog/",
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: "https://premiere-pro-mcp.com/blog/what-is-a-premiere-pro-mcp-server/",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://premiere-pro-mcp.com/blog/ai-video-editing-with-premiere-pro/",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://premiere-pro-mcp.com/blog/premiere-pro-workflow-automation/",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://premiere-pro-mcp.com/changelog/",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: "https://premiere-pro-mcp.com/privacy/",
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ]
}
