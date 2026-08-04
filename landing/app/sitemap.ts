import type { MetadataRoute } from "next"

export const dynamic = "force-static"

const lastModified = new Date("2026-08-04")

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
