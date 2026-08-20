import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { articleBySlug, articles } from "@/lib/articles"

type ArticlePageProps = {
  params: Promise<{ slug: string }>
}

export const dynamic = "force-static"

export function generateStaticParams() {
  return articles.map(({ slug }) => ({ slug }))
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params
  const article = articleBySlug.get(slug)

  if (!article) {
    return {}
  }

  return {
    title: article.title,
    description: article.description,
    keywords: article.keywords,
    alternates: { canonical: `/blog/${article.slug}/` },
    openGraph: {
      title: article.title,
      description: article.description,
      url: `/blog/${article.slug}/`,
      type: "article",
      publishedTime: article.publishedAt,
      modifiedTime: article.modifiedAt,
      authors: ["Premiere Pro MCP contributors"],
    },
  }
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params
  const article = articleBySlug.get(slug)

  if (!article) {
    notFound()
  }

  const relatedArticles = articles.filter((candidate) => candidate.slug !== article.slug).slice(0, 2)
  const articleUrl = `https://premiere-pro-mcp.com/blog/${article.slug}/`
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${articleUrl}#article`,
        headline: article.title,
        description: article.description,
        url: articleUrl,
        datePublished: article.publishedAt,
        dateModified: article.modifiedAt,
        inLanguage: "en-US",
        author: {
          "@type": "Organization",
          name: "Premiere Pro MCP contributors",
          url: "https://github.com/leancoderkavy/premiere-pro-mcp",
        },
        publisher: { "@id": "https://premiere-pro-mcp.com/#organization" },
        mainEntityOfPage: articleUrl,
        keywords: article.keywords.join(", "),
      },
      {
        "@type": "FAQPage",
        "@id": `${articleUrl}#faq`,
        mainEntity: article.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${articleUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Premiere Pro MCP", item: "https://premiere-pro-mcp.com/" },
          { "@type": "ListItem", position: 2, name: "Guides", item: "https://premiere-pro-mcp.com/blog/" },
          { "@type": "ListItem", position: 3, name: article.title, item: articleUrl },
        ],
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="main-content" className="min-h-screen bg-black px-5 py-12 text-zinc-100 sm:py-20">
        <article className="mx-auto max-w-3xl">
          <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
            <Link href="/" className="hover:text-purple-200">Premiere Pro MCP</Link>{" "}
            <span aria-hidden="true">/</span>{" "}
            <Link href="/blog/" className="hover:text-purple-200">Guides</Link>{" "}
            <span aria-hidden="true">/</span> <span className="text-zinc-400">{article.eyebrow}</span>
          </nav>

          <header className="border-b border-zinc-800 pb-10 pt-10 sm:pb-14 sm:pt-14">
            <p className="font-mono text-sm font-medium uppercase tracking-[0.15em] text-purple-300">{article.eyebrow}</p>
            <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-white sm:text-6xl">{article.title}</h1>
            <p className="mt-6 text-lg leading-8 text-zinc-400">{article.description}</p>
            <div className="mt-7 flex items-center gap-3 text-sm text-zinc-500">
              <time dateTime={article.publishedAt}>Published August 19, 2026</time>
              <span aria-hidden="true">·</span>
              <span>{article.readingTime}</span>
            </div>
          </header>

          <div className="py-10 sm:py-14">
            {article.sections.map((section) => (
              <section key={section.heading} className="border-b border-zinc-900 py-9 first:pt-0 last:border-b-0">
                <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{section.heading}</h2>
                <div className="mt-5 space-y-5 text-[1.0625rem] leading-8 text-zinc-300">
                  {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
                {section.bullets ? (
                  <ul className="mt-6 list-disc space-y-3 pl-5 leading-7 text-zinc-300 marker:text-purple-300">
                    {section.bullets.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <section className="border-y border-zinc-800 py-10" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight text-white">Questions editors ask</h2>
            <div className="mt-6 divide-y divide-zinc-800">
              {article.faqs.map((faq) => (
                <details key={faq.question} className="group py-5">
                  <summary className="cursor-pointer list-none pr-8 font-medium text-zinc-100 marker:content-none group-open:text-purple-200">
                    {faq.question}
                  </summary>
                  <p className="mt-3 leading-7 text-zinc-400">{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="py-10" aria-labelledby="resources-heading">
            <h2 id="resources-heading" className="text-2xl font-semibold tracking-tight text-white">Keep learning</h2>
            <ul className="mt-5 space-y-3">
              {article.resources.map((resource) => (
                <li key={resource.href}>
                  <a href={resource.href} className="font-medium text-purple-200 hover:text-white">
                    {resource.label} <span aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-purple-300/40 bg-purple-300/10 p-7 sm:p-9" aria-labelledby="start-heading">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-purple-200">A practical next step</p>
            <h2 id="start-heading" className="mt-3 text-2xl font-semibold tracking-tight text-white">Start with a safe Premiere connection check.</h2>
            <p className="mt-3 max-w-2xl leading-7 text-zinc-300">
              Connect your assistant, verify the local bridge without changing a project, then inspect the active sequence before requesting a supported edit.
            </p>
            <Link href="/docs/" className="mt-6 inline-flex bg-purple-300 px-5 py-3 font-medium text-black transition-colors hover:bg-white">
              Read the setup guide <span aria-hidden="true" className="ml-2">→</span>
            </Link>
          </section>

          <aside className="border-t border-zinc-800 py-10" aria-labelledby="related-heading">
            <h2 id="related-heading" className="text-xl font-semibold text-white">Related guides</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {relatedArticles.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}/`} className="border border-zinc-800 p-5 transition-colors hover:border-purple-400/60">
                  <p className="font-mono text-xs uppercase tracking-[0.12em] text-purple-300">{related.eyebrow}</p>
                  <p className="mt-3 font-semibold text-zinc-100">{related.title}</p>
                </Link>
              ))}
            </div>
          </aside>
        </article>
      </main>
    </>
  )
}
