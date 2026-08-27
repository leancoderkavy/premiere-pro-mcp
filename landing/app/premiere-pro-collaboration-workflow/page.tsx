import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Network, ShieldCheck, UsersRound } from "lucide-react"
import { Footer } from "@/components/sections/footer"
import { WorkflowChooser } from "./workflow-chooser"

const pageUrl = "https://premiere-pro-mcp.com/premiere-pro-collaboration-workflow/"

export const metadata: Metadata = {
  title: "Premiere Pro Collaboration Workflow: Choose a Safe MCP Starting Point",
  description: "Choose a cautious first step for a local Premiere project, a shared-storage Production, or a remote Team Project before evaluating a reviewable MCP workflow.",
  alternates: { canonical: "/premiere-pro-collaboration-workflow/" },
  keywords: ["Premiere Pro Team Projects vs Productions", "Premiere Pro collaboration workflow", "Premiere Pro shared storage workflow", "Premiere Pro MCP workflow"],
  openGraph: {
    title: "Choose a Safe Premiere Pro Collaboration Workflow",
    description: "Start with the right collaboration context, then verify a local MCP connection without changing a project.",
    url: "/premiere-pro-collaboration-workflow/",
    type: "website",
    images: [{ url: "/marketing/premiere-pro-mcp-social-square-v1.png", width: 1254, height: 1254, alt: "MCP for Adobe Premiere Pro — choose a reviewable workflow starting point" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Choose a Safe Premiere Pro Collaboration Workflow",
    description: "Start with the right collaboration context, then verify a local MCP connection without changing a project.",
    images: ["/marketing/premiere-pro-mcp-social-square-v1.png"],
  },
}

const faqs = [
  { question: "Does this guide choose an Adobe collaboration model for me?", answer: "No. It explains the boundary between a local project, Adobe Productions, and Adobe Team Projects, then points to the relevant Adobe guidance. Your team decides its storage, permissions, and workflow policy." },
  { question: "Does a successful connection check prove every Premiere workflow is supported?", answer: "No. The read-only check verifies the local connection path. Capability, permissions, an active project, an active sequence, and real-host behavior remain separate checks for the specific operation you need." },
  { question: "Does the workflow guide collect project information?", answer: "No. Choosing a context does not inspect or store a project. The anonymous event records only the selected workflow label when analytics is permitted; it never includes project names, paths, media, prompts, or identity." },
]

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "@id": `${pageUrl}#webpage`, name: "Premiere Pro Collaboration Workflow: Choose a Safe MCP Starting Point", description: "Choose a cautious first step for a local Premiere project, a shared-storage Production, or a remote Team Project before evaluating a reviewable MCP workflow.", url: pageUrl, isPartOf: { "@id": "https://premiere-pro-mcp.com/#website" }, about: { "@id": "https://premiere-pro-mcp.com/#software" }, inLanguage: "en-US" },
    { "@type": "FAQPage", "@id": `${pageUrl}#faq`, mainEntity: faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    { "@type": "BreadcrumbList", "@id": `${pageUrl}#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: "MCP for Adobe Premiere Pro", item: "https://premiere-pro-mcp.com/" }, { "@type": "ListItem", position: 2, name: "Collaboration Workflow", item: pageUrl }] },
  ],
}

const principles = [
  { icon: UsersRound, title: "Start from the collaboration model", description: "Adobe positions Productions for shared-storage, multi-project work and Team Projects for cloud-managed collaboration. The right first question is where the project lives and how people share it." },
  { icon: ShieldCheck, title: "Keep the first evaluation read-only", description: "Use a copied or non-sensitive project, check the local connection, and treat a returned diagnostic as a setup decision—not a reason to retry a mutating request." },
  { icon: Network, title: "Make each tool claim specific", description: "A local MCP connection does not grant Team Project permissions, create a Production policy, or prove a future edit worked. Verify the capability and result you actually need." },
]

export default function PremiereProCollaborationWorkflowPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <header className="border-b border-zinc-800 bg-black/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold text-white"><Image src="/marketing/premiere-pro-mcp-mark-v1.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" /><span>premiere-pro-mcp</span></Link>
          <Link href="/#install" className="inline-flex min-h-11 items-center rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900">Install first</Link>
        </div>
      </header>
      <main id="main-content" className="min-h-screen bg-black text-zinc-100">
        <section className="border-b border-zinc-900 px-5 pb-16 pt-14 sm:pb-24 sm:pt-20">
          <div className="mx-auto max-w-4xl">
            <nav aria-label="Breadcrumb" className="text-sm text-zinc-500"><Link href="/" className="hover:text-purple-200">MCP for Adobe Premiere Pro</Link> <span aria-hidden="true">/</span> Collaboration workflow</nav>
            <p className="mt-10 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Premiere collaboration workflow · no-change first step</p>
            <h1 className="mt-5 text-balance text-4xl font-bold tracking-[-0.045em] text-white sm:text-6xl">Choose the collaboration context <span className="text-purple-300">before you automate.</span></h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400 sm:text-xl">A local project, a shared-storage Production, and a remote Team Project have different Adobe workflow boundaries. Pick your context, read the current Adobe guidance, then start any MCP evaluation with a no-change connection check.</p>
            <a href="#choose" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-lg bg-purple-300 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black">Choose a safe starting point <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            <p className="mt-4 text-sm text-zinc-500">Free guide · no account, card, or project upload required · your team keeps the workflow decision</p>
          </div>
        </section>

        <section className="px-5 py-14 sm:py-20" aria-labelledby="principles-heading">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl"><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">The boundary that prevents bad automation</p><h2 id="principles-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Pick the operating model. Then test one observable step.</h2></div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {principles.map((principle, index) => <article key={principle.title} className="border border-zinc-800 bg-[#08080a] p-6 sm:p-7"><p className="font-mono text-xs font-semibold tracking-[0.14em] text-zinc-500">0{index + 1}</p><principle.icon className="mt-8 h-6 w-6 text-purple-300" strokeWidth={1.6} aria-hidden="true" /><h3 className="mt-5 text-xl font-semibold tracking-tight text-white">{principle.title}</h3><p className="mt-3 leading-7 text-zinc-400">{principle.description}</p></article>)}
            </div>
          </div>
        </section>

        <section id="choose" className="border-y border-zinc-900 bg-[#050506] px-5 py-14 sm:py-20" aria-labelledby="chooser-heading">
          <div className="mx-auto max-w-4xl"><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Free workflow-fit guide</p><h2 id="chooser-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Find the cautious first move for your project context.</h2><p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">This is a routing aid, not a compatibility test. It keeps Adobe collaboration choices separate from the local MCP connection you can verify yourself.</p><div className="mt-10"><WorkflowChooser /></div></div>
        </section>

        <section className="px-5 py-14 sm:py-20" aria-labelledby="next-heading">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1.25fr] lg:items-start"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">After the check</p><h2 id="next-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Keep the next request bounded.</h2></div><ul className="space-y-4 text-zinc-300">{["Confirm the local server, connector, open project, and active sequence without making a change.", "For a Production handoff, use Project Intake only with a narrow, approved facility template and a human exception owner.", "For a Team Project, check the current Adobe collaboration state and permissions before treating any local MCP result as team-wide evidence.", "Inspect the returned diagnostic or result before you ask for a later supported change."].map((item) => <li key={item} className="flex gap-3 border-b border-zinc-900 pb-4 last:border-b-0"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" aria-hidden="true" /><span className="leading-7">{item}</span></li>)}</ul></div>
        </section>

        <section className="border-y border-zinc-900 bg-[#050506] px-5 py-14 sm:py-20" aria-labelledby="faq-heading"><div className="mx-auto max-w-4xl"><p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Questions before the first prompt</p><h2 id="faq-heading" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">Clear limits make a useful first test.</h2><div className="mt-10 divide-y divide-zinc-800 border-y border-zinc-800">{faqs.map((faq) => <details key={faq.question} className="group py-5"><summary className="cursor-pointer list-none pr-8 font-medium text-zinc-100 marker:content-none group-open:text-purple-200">{faq.question}</summary><p className="mt-3 max-w-3xl leading-7 text-zinc-400">{faq.answer}</p></details>)}</div><Link href="/project-intake/" className="mt-8 inline-flex items-center gap-2 font-medium text-purple-200 hover:text-white">Open the Project Intake preview guide <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div></section>
      </main>
      <Footer />
    </>
  )
}
