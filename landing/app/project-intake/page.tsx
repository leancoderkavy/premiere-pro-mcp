import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, CheckCircle2, ClipboardCheck, FileSearch, ShieldCheck } from "lucide-react"
import { Footer } from "@/components/sections/footer"
import { ProjectIntakePrompts } from "./project-intake-prompts"
import { ProjectIntakeTemplateBuilder } from "./project-intake-template-builder"

const pageUrl = "https://premiere-pro-mcp.com/project-intake/"

export const metadata: Metadata = {
  title: "Premiere Pro Project Intake: Run a Read-Only Workflow Review",
  description:
    "Prepare a bounded, read-only Premiere Pro Project Intake preview with a safe connection check, a schema-valid starter or approved template, and a path-redacted review report.",
  alternates: { canonical: "/project-intake/" },
  keywords: [
    "Premiere Pro project intake workflow",
    "Premiere Pro project organization review",
    "assistant editor project handoff",
    "read-only Premiere Pro project preview",
  ],
  openGraph: {
    title: "Premiere Pro Project Intake: Run a Read-Only Workflow Review",
    description:
      "Start with a safe connection check, then preview a path-redacted Project Intake report before anyone changes a Premiere project.",
    url: "/project-intake/",
    type: "website",
    images: [
      {
        url: "/marketing/premiere-pro-mcp-social-square-v1.png",
        width: 1254,
        height: 1254,
        alt: "MCP for Adobe Premiere Pro — reviewable Project Intake workflow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Premiere Pro Project Intake: Run a Read-Only Workflow Review",
    description:
      "Start with a safe connection check, then preview a path-redacted Project Intake report before anyone changes a Premiere project.",
    images: ["/marketing/premiere-pro-mcp-social-square-v1.png"],
  },
}

const faqs = [
  {
    question: "Does Project Intake change a Premiere project?",
    answer:
      "No. The Project Intake preview returns a path-redacted report and proposed organization actions. It does not change Premiere or persist the facility template.",
  },
  {
    question: "What should I use as the first test project?",
    answer:
      "Use a copied or non-sensitive project with an active sequence. A read-only connection check confirms only the current local setup; it is not a universal host-compatibility guarantee.",
  },
  {
    question: "Does the report prove a project is ready for delivery?",
    answer:
      "No. It reports the bounded checks in the approved template. A human owner still reviews exceptions, truncated findings, and any later change before relying on the result.",
  },
  {
    question: "Can I use a starter template as-is?",
    answer:
      "Only as a non-sensitive evaluation sample. A human policy owner must review and replace the starter's bins, media rules, frame rates, proxy policy, and organization rules before relying on it for a facility workflow.",
  },
]

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      name: "Premiere Pro Project Intake: Run a Read-Only Workflow Review",
      description:
        "Prepare a bounded, read-only Premiere Pro Project Intake preview with a safe connection check, a schema-valid starter or approved template, and a path-redacted review report.",
      url: pageUrl,
      isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" },
      about: { "@id": "https://premiere-pro-mcp.com/#software" },
      inLanguage: "en-US",
    },
    {
      "@type": "FAQPage",
      "@id": `${pageUrl}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${pageUrl}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "MCP for Adobe Premiere Pro", item: "https://premiere-pro-mcp.com/" },
        { "@type": "ListItem", position: 2, name: "Project Intake", item: pageUrl },
      ],
    },
  ],
}

const steps = [
  {
    icon: ShieldCheck,
    title: "Confirm the local path",
    description: "Check the selected bridge, an open project, and an active sequence before requesting a workflow.",
  },
  {
    icon: FileSearch,
    title: "Preview an approved template",
    description: "Ask for a narrow, path-redacted review with explicit organization proposals and no mutation.",
  },
  {
    icon: ClipboardCheck,
    title: "Review before anyone changes work",
    description: "A human owner accepts, escalates, or stops. A proposal is never permission to mutate the project.",
  },
]

export default function ProjectIntakePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <header className="border-b border-zinc-800 bg-black/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold text-white">
            <Image src="/marketing/premiere-pro-mcp-mark-v1.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
            <span>premiere-pro-mcp</span>
          </Link>
          <Link href="/#install" className="inline-flex min-h-11 items-center rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900">
            Install first
          </Link>
        </div>
      </header>
      <main id="main-content" className="min-h-screen bg-black text-zinc-100">
        <section className="border-b border-zinc-900 px-5 pb-16 pt-14 sm:pb-24 sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <nav aria-label="Breadcrumb" className="text-sm text-zinc-500">
              <Link href="/" className="hover:text-purple-200">MCP for Adobe Premiere Pro</Link> <span aria-hidden="true">/</span> Project Intake
            </nav>
            <p className="mt-10 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Project Intake · preview-only workflow</p>
            <h1 className="mt-5 max-w-4xl text-balance text-4xl font-bold tracking-[-0.045em] text-white sm:text-6xl">
              Turn a project handoff into a <span className="text-purple-300">reviewable intake.</span>
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400 sm:text-xl">
              For assistant editors and post leads who need to inspect an open Premiere project against an approved template before anyone reorganizes it.
            </p>
            <a href="#try" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-lg bg-purple-300 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black">
              Copy the safe first prompt <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <p className="mt-4 text-sm text-zinc-500">Free, local-first setup · no account or card required · use a copied test project first</p>
          </div>
        </section>

        <section className="px-5 py-14 sm:py-20" aria-labelledby="workflow-heading">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">What the workflow does</p>
              <h2 id="workflow-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">A clear decision before a project changes.</h2>
              <p className="mt-5 text-lg leading-8 text-zinc-400">The review gives a supervisor and assistant editor a common record of what the template checked, what needs attention, and what must remain a human decision.</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <article key={step.title} className="border border-zinc-800 bg-[#08080a] p-6 sm:p-7">
                  <p className="font-mono text-xs font-semibold tracking-[0.14em] text-zinc-500">0{index + 1}</p>
                  <step.icon className="mt-8 h-6 w-6 text-purple-300" strokeWidth={1.6} aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-white">{step.title}</h3>
                  <p className="mt-3 leading-7 text-zinc-400">{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="try" className="border-y border-zinc-900 bg-[#050506] px-5 py-14 sm:py-20" aria-labelledby="try-heading">
          <div className="mx-auto max-w-4xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Try the read-only path</p>
            <h2 id="try-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Copy the safe prompt. Then choose a starter policy.</h2>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">The first prompt checks the connection only. Then choose a schema-valid starter policy or use your approved template for a path-redacted intake preview.</p>
            <div className="mt-10"><ProjectIntakePrompts /></div>
            <div id="starter-template"><ProjectIntakeTemplateBuilder /></div>
          </div>
        </section>

        <section className="px-5 py-14 sm:py-20" aria-labelledby="boundary-heading">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.25fr] lg:items-start">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Before you rely on it</p>
              <h2 id="boundary-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">A report is evidence, not an editorial approval.</h2>
            </div>
            <ul className="space-y-4 text-zinc-300">
              {[
                "Use a copied or non-sensitive project while you evaluate a new client, connector, or template.",
                "Starter templates deliberately omit approved media paths. Add any path policy only after a human owner reviews and approves it.",
                "Start with deterministic organization rules: expected bins, allowed labels, naming patterns, and allowlisted metadata.",
                "Review every finding and exception with a human owner. A proposed action is not permission to apply it.",
                "Keep preview, structural verification, playback review, and exported-frame verification as separate evidence classes.",
              ].map((item) => (
                <li key={item} className="flex gap-3 border-b border-zinc-900 pb-4 last:border-b-0">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" aria-hidden="true" />
                  <span className="leading-7">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-y border-zinc-900 bg-[#050506] px-5 py-14 sm:py-20" aria-labelledby="faq-heading">
          <div className="mx-auto max-w-4xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Questions before a handoff</p>
            <h2 id="faq-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Straight answers about the preview boundary.</h2>
            <div className="mt-10 divide-y divide-zinc-800 border-y border-zinc-800">
              {faqs.map((faq) => (
                <details key={faq.question} className="group py-5">
                  <summary className="cursor-pointer list-none pr-8 font-medium text-zinc-100 marker:content-none group-open:text-purple-200">{faq.question}</summary>
                  <p className="mt-3 max-w-3xl leading-7 text-zinc-400">{faq.answer}</p>
                </details>
              ))}
            </div>
            <Link href="/blog/premiere-pro-project-intake-checklist/" className="mt-8 inline-flex items-center gap-2 font-medium text-purple-200 hover:text-white">
              Read the full Project Intake checklist <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
