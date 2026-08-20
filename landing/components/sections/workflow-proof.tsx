"use client"

import { useState } from "react"
import { CheckCircle2, ClipboardCheck, FileSearch, ListChecks, ScanSearch, ShieldCheck } from "lucide-react"

type WorkflowStep = {
  id: "capture" | "search" | "plan" | "preview"
  number: string
  title: string
  tool: string
  summary: string
  boundary: string
  details: string[]
  icon: typeof ScanSearch
}

const steps: WorkflowStep[] = [
  {
    id: "capture",
    number: "01",
    title: "Capture context",
    tool: "manage_project_context",
    summary: "Create a bounded local snapshot of the active sequence and source identities.",
    boundary: "Read-only · opt-in local index",
    details: [
      "No context is captured until an MCP client explicitly calls the tool.",
      "Native project and media paths are hashed before persistence.",
      "Capture establishes revisions for later stale-state checks.",
    ],
    icon: ScanSearch,
  },
  {
    id: "search",
    number: "02",
    title: "Find evidence",
    tool: "search_project_context",
    summary: "Retrieve only the clips, transcript passages, observations, and placements relevant to the request.",
    boundary: "Read-only · bounded evidence",
    details: [
      "Search returns stable Premiere identities and revision provenance.",
      "The client can limit context to the kinds needed for one editing intent.",
      "A stale or ambiguous state calls for a fresh capture, not a blind edit.",
    ],
    icon: FileSearch,
  },
  {
    id: "plan",
    number: "03",
    title: "Build the plan",
    tool: "create_context_edit_plan",
    summary: "Produce an evidence-backed, non-mutating candidate scaffold before constructing timeline operations.",
    boundary: "Non-mutating · editorial review required",
    details: [
      "Candidates include source/time evidence and stale-state guards.",
      "The plan is not proof that an editorial decision is correct.",
      "The editor and chosen AI client can refine the plan before any mutation.",
    ],
    icon: ListChecks,
  },
  {
    id: "preview",
    number: "04",
    title: "Preview, approve, verify",
    tool: "preview_edit_plan → apply_edit_plan",
    summary: "Preview the compound edit, then apply only with the exact confirmation token and current targets.",
    boundary: "Explicit confirmation · post-state verification",
    details: [
      "Every target is revalidated before an edit is attempted.",
      "The preview confirmation token prevents applying a different plan by mistake.",
      "Returned state or diagnostics are evidence; an attempted command is not enough.",
    ],
    icon: ClipboardCheck,
  },
]

export function WorkflowProof() {
  const [selectedId, setSelectedId] = useState<WorkflowStep["id"]>("capture")
  const selected = steps.find((step) => step.id === selectedId) ?? steps[0]
  const SelectedIcon = selected.icon

  return (
    <section
      className="relative mx-auto mt-12 max-w-6xl border border-zinc-800 bg-[#08080a] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:mt-16 sm:p-7 lg:p-8"
      aria-labelledby="project-context-heading"
    >
      <div className="flex flex-col gap-5 border-b border-zinc-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Illustrated product workflow</p>
          <h2 id="project-context-heading" className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Keep the context. Review the change.
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-zinc-400">
          A local project-context workflow makes the request inspectable from first evidence to returned result. This maps real MCP tools; it is not a recording of a live Premiere session.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Project context workflow steps">
          {steps.map((step) => {
            const Icon = step.icon
            const active = step.id === selected.id

            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(step.id)}
                  aria-pressed={active}
                  aria-controls="workflow-step-detail"
                  className={`flex min-h-20 w-full items-center gap-3 border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a] ${
                    active ? "border-purple-400/70 bg-purple-400/[0.09]" : "border-zinc-800 bg-black hover:border-zinc-600"
                  }`}
                >
                  <span className={`font-mono text-xs ${active ? "text-purple-200" : "text-zinc-500"}`}>{step.number}</span>
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-purple-200" : "text-zinc-500"}`} aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-100">{step.title}</span>
                    <span className="mt-1 block font-mono text-[0.65rem] text-zinc-500">{step.tool}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <article id="workflow-step-detail" aria-live="polite" className="border border-zinc-800 bg-black p-5 sm:p-7">
          <div className="flex flex-col gap-5 border-b border-zinc-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center border border-purple-400/50 bg-purple-400/[0.08] text-purple-200">
                <SelectedIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-purple-300">{selected.tool}</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{selected.title}</h3>
              </div>
            </div>
            <p className="inline-flex w-fit items-center gap-2 border border-emerald-400/30 bg-emerald-400/[0.06] px-3 py-2 text-xs font-medium text-emerald-200">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {selected.boundary}
            </p>
          </div>

          <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300">{selected.summary}</p>
          <ul className="mt-6 space-y-3 border-t border-zinc-900 pt-5 text-sm leading-6 text-zinc-400">
            {selected.details.map((detail) => (
              <li key={detail} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  )
}
