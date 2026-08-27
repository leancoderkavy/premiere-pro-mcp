"use client"

import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { trackOnboardingEvent } from "@/lib/onboarding-events"
import { safeFirstPrompt } from "@/lib/product"

type WorkflowKind = "single_project" | "production" | "team_project"
type CopyState = "idle" | "copied" | "unavailable"

const workflows: Record<WorkflowKind, {
  description: string
  nextStep: string
  sourceHref: string
  sourceLabel: string
  title: string
}> = {
  single_project: {
    title: "One editor, one active project",
    description: "Start on a copied or non-sensitive project. The first useful proof is that your local MCP client, connector, open project, and active sequence can communicate without changing anything.",
    nextStep: "Install the local server and connector, open a copied project with an active sequence, then run the read-only connection check below.",
    sourceHref: "https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-productions/productions-faq.html",
    sourceLabel: "Adobe: Productions FAQ",
  },
  production: {
    title: "A large, multi-project production on shared storage",
    description: "Adobe describes Productions as a shared-storage workflow for organizing related Premiere projects. This server can help you inspect a local, open project, but it does not decide your storage, locking, or facility policy for you.",
    nextStep: "Keep the first test local and copied. Confirm the connection without changes, then use the Project Intake preview only with an approved facility template.",
    sourceHref: "https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-productions/about-productions.html",
    sourceLabel: "Adobe: About Productions",
  },
  team_project: {
    title: "Remote collaborators in a shared cloud project",
    description: "Adobe describes Team Projects as a cloud-managed collaboration path. Treat your Team Project permissions, sync state, and collaboration policy as Adobe workflow decisions; this local MCP connection does not grant or prove them.",
    nextStep: "Check the current Adobe Team Projects guidance first. If you evaluate this server, do it in a copied test context and start with the same no-change local connection check.",
    sourceHref: "https://helpx.adobe.com/premiere/desktop/collaborate-with-others/collaborate-using-team-projects/when-to-use-team-projects-and-when-to-use-productions.html",
    sourceLabel: "Adobe: Team Projects vs. Productions",
  },
}

const choices: Array<{ id: WorkflowKind; label: string; detail: string }> = [
  { id: "single_project", label: "One editor, one project", detail: "A local project or a small test sequence." },
  { id: "production", label: "A Production on shared storage", detail: "Multiple related projects and a facility workflow." },
  { id: "team_project", label: "A remote Team Project", detail: "Cloud-shared collaboration with other editors." },
]

export function WorkflowChooser() {
  const [selected, setSelected] = useState<WorkflowKind | null>(null)
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const recommendation = selected ? workflows[selected] : null

  function chooseWorkflow(nextWorkflow: WorkflowKind) {
    if (nextWorkflow === selected) return
    setSelected(nextWorkflow)
    setCopyState("idle")
    trackOnboardingEvent("onboarding_workflow_guide_recommendation_viewed", { workflow_type: nextWorkflow })
  }

  async function copyPrompt() {
    if (!selected) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable")
      await navigator.clipboard.writeText(safeFirstPrompt)
      setCopyState("copied")
      trackOnboardingEvent("onboarding_workflow_guide_prompt_copied", { workflow_type: selected })
      window.setTimeout(() => setCopyState("idle"), 2200)
    } catch {
      setCopyState("unavailable")
    }
  }

  return (
    <div className="border border-zinc-800 bg-[#08080a] p-5 sm:p-7">
      <fieldset>
        <legend className="text-xl font-semibold tracking-tight text-white">Which collaboration context are you evaluating?</legend>
        <p className="mt-3 max-w-2xl leading-7 text-zinc-400">This guide does not save your answer or inspect a project. It only gives you a cautious local starting point and the relevant Adobe reference.</p>
        <div className="mt-6 grid gap-3">
          {choices.map((choice) => (
            <label key={choice.id} className={`flex min-h-16 cursor-pointer items-start gap-3 border p-4 transition-colors ${selected === choice.id ? "border-purple-300 bg-purple-300/10" : "border-zinc-800 hover:border-zinc-600"}`}>
              <input
                type="radio"
                name="workflow-kind"
                value={choice.id}
                checked={selected === choice.id}
                onChange={() => chooseWorkflow(choice.id)}
                className="mt-1 h-4 w-4 accent-violet-300"
              />
              <span>
                <span className="block font-medium text-zinc-100">{choice.label}</span>
                <span className="mt-1 block text-sm leading-6 text-zinc-400">{choice.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {recommendation ? (
        <section className="mt-7 border-t border-zinc-800 pt-7" aria-live="polite" aria-label="Your safe starting point">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-purple-300">Your safe starting point</p>
          <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">{recommendation.title}</h3>
          <p className="mt-3 max-w-2xl leading-7 text-zinc-400">{recommendation.description}</p>
          <p className="mt-4 max-w-2xl leading-7 text-zinc-200">{recommendation.nextStep}</p>
          <a href={recommendation.sourceHref} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-purple-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]">
            {recommendation.sourceLabel} <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <div className="mt-6 border border-zinc-800 bg-black p-4">
            <p className="text-sm font-medium text-zinc-200">Use this first in your compatible AI client</p>
            <code className="mt-3 block text-sm leading-7 text-zinc-300">{safeFirstPrompt}</code>
            <button
              type="button"
              onClick={copyPrompt}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-purple-300 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyState === "copied" ? "Copied" : "Copy the no-change prompt"}
            </button>
            {copyState === "unavailable" ? (
              <p className="mt-3 inline-flex items-center gap-2 text-sm text-amber-200" role="status">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> Copy is unavailable here. Select the visible prompt and copy it manually.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
