import type { MetadataRoute } from "next"
import { articles } from "@/lib/articles"
import { product } from "@/lib/product"

export const dynamic = "force-static"

const siteUrl = "https://premiere-pro-mcp.com"
const latestArticleDate = new Date(
  `${articles.reduce((latest, article) => article.modifiedAt > latest ? article.modifiedAt : latest, articles[0].modifiedAt)}T00:00:00Z`,
)
const productContentDate = new Date(`${product.releaseDate}T00:00:00Z`)
const setupContentDate = new Date("2026-09-10T00:00:00Z")

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/tools/`, lastModified: setupContentDate, changeFrequency: "weekly", priority: 0.9 },
    { url: `${siteUrl}/workflows/`, lastModified: new Date("2026-09-04T00:00:00Z"), changeFrequency: "monthly", priority: 0.9 },
    { url: `${siteUrl}/docs/troubleshooting/`, lastModified: new Date("2026-09-04T00:00:00Z"), changeFrequency: "monthly", priority: 0.8 },
    {
      url: `${siteUrl}/`,
      lastModified: setupContentDate,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/docs/`,
      lastModified: setupContentDate,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/project-intake/`,
      lastModified: setupContentDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/premiere-pro-collaboration-workflow/`,
      lastModified: setupContentDate,
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
      lastModified: productContentDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/changelog/`,
      lastModified: productContentDate,
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
