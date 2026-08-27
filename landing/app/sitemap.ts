import type { MetadataRoute } from "next"
import { articles } from "@/lib/articles"

export const dynamic = "force-static"

const siteUrl = "https://premiere-pro-mcp.com"
const latestArticleDate = new Date(
  `${articles.reduce((latest, article) => article.modifiedAt > latest ? article.modifiedAt : latest, articles[0].modifiedAt)}T00:00:00Z`,
)

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      lastModified: latestArticleDate,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/docs/`,
      lastModified: latestArticleDate,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/project-intake/`,
      lastModified: new Date("2026-08-26T00:00:00Z"),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/premiere-pro-collaboration-workflow/`,
      lastModified: new Date("2026-08-27T00:00:00Z"),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/blog/`,
      lastModified: latestArticleDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...articles.map((article) => ({
      url: `${siteUrl}/blog/${article.slug}/`,
      lastModified: new Date(`${article.modifiedAt}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    {
      url: `${siteUrl}/facts/`,
      lastModified: latestArticleDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/changelog/`,
      lastModified: latestArticleDate,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/privacy/`,
      lastModified: latestArticleDate,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ]
}
