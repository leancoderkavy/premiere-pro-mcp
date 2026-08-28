"use client"

import { Check, Copy, ShieldCheck, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { trackOnboardingEvent } from "@/lib/onboarding-events"
import {
  formatProjectIntakeStarterRequest,
  projectIntakeStarterTemplates,
  type ProjectIntakeStarterTemplate,
} from "@/lib/project-intake-starter-templates"

type CopyState = "idle" | "copied" | "unavailable"

export function ProjectIntakeTemplateBuilder() {
  const [selected, setSelected] = useState<ProjectIntakeStarterTemplate | null>(null)
  const [copyState, setCopyState] = useState<CopyState>("idle")

  function selectTemplate(starter: ProjectIntakeStarterTemplate) {
    setSelected(starter)
    setCopyState("idle")
    trackOnboardingEvent("onboarding_project_intake_template_selected", { template_kind: starter.key })
  }

  async function copyRequest() {
    if (!selected) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable")
      await navigator.clipboard.writeText(formatProjectIntakeStarterRequest(selected))
      setCopyState("copied")
      trackOnboardingEvent("onboarding_project_intake_template_copied", { template_kind: selected.key })
      window.setTimeout(() => setCopyState("idle"), 2200)
    } catch {
      setCopyState("unavailable")
    }
  }

  return (
    <div className="mt-10 border border-zinc-800 bg-[#08080a] p-5 sm:p-7">
      <fieldset>
        <legend className="text-xl font-semibold tracking-tight text-white">Choose a no-sensitive-data starter policy</legend>
        <p className="mt-3 max-w-3xl leading-7 text-zinc-400">Each sample is valid for <code>preview_project_intake</code>, has no approved media paths, and requests a preview only. A policy owner must review and replace its bins, media rules, and checks before real use.</p>
        <div className="mt-6 grid gap-3">
          {projectIntakeStarterTemplates.map((starter) => {
            const isSelected = selected?.key === starter.key
            return (
              <label
                key={starter.key}
                className={`block cursor-pointer rounded-lg border p-4 transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-purple-300 ${isSelected ? "border-purple-300 bg-purple-300/10" : "border-zinc-800 bg-black hover:border-zinc-600"}`}
              >
                <input
                  type="radio"
                  name="project-intake-starter-template"
                  value={starter.key}
                  checked={isSelected}
                  onChange={() => selectTemplate(starter)}
                  className="sr-only"
                />
                <span className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-purple-300 bg-purple-300 text-black" : "border-zinc-600"}`} aria-hidden="true">
                    {isSelected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                  </span>
                  <span>
                    <span className="block font-semibold text-white">{starter.label}</span>
                    <span className="mt-1 block leading-6 text-zinc-400">{starter.description}</span>
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {selected ? (
        <section className="mt-7 border-t border-zinc-800 pt-7" aria-live="polite" aria-labelledby="starter-request-heading">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" aria-hidden="true" />
            <div>
              <h3 id="starter-request-heading" className="font-semibold text-white">{selected.label} request</h3>
              <ul className="mt-3 space-y-1 text-sm leading-6 text-zinc-400">
                {selected.checks.map((check) => <li key={check}>• {check}</li>)}
              </ul>
            </div>
          </div>
          <pre className="mt-5 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 text-sm leading-6 text-zinc-200"><code>{formatProjectIntakeStarterRequest(selected)}</code></pre>
          <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={copyRequest}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-purple-300 bg-purple-300 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]"
            >
              {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              <span>{copyState === "copied" ? "Copied" : "Copy starter request"}</span>
            </button>
            {copyState === "unavailable" ? (
              <p className="inline-flex items-center gap-2 text-sm text-amber-200" role="status">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                Copy is unavailable here. Select the visible request and copy it manually.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
