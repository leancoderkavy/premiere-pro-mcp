"use client"

import { Check, Copy, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { trackOnboardingEvent } from "@/lib/onboarding-events"
import { projectIntakePreviewPrompt, safeFirstPrompt } from "@/lib/product"

type CopyState = "idle" | "copied" | "unavailable"

type PromptCardProps = {
  description: string
  label: string
  prompt: string
  promptKind: "safe_check" | "intake_preview"
  title: string
}

function PromptCard({ description, label, prompt, promptKind, title }: PromptCardProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle")

  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable")
      await navigator.clipboard.writeText(prompt)
      setCopyState("copied")
      trackOnboardingEvent("onboarding_project_intake_prompt_copied", { prompt_kind: promptKind })
      window.setTimeout(() => setCopyState("idle"), 2200)
    } catch {
      setCopyState("unavailable")
    }
  }

  return (
    <article className="rounded-xl border border-zinc-800 bg-[#08080a] p-5 sm:p-6">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-purple-300">{label}</p>
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-3 max-w-2xl leading-7 text-zinc-400">{description}</p>
      <code className="mt-5 block overflow-x-auto rounded-lg border border-zinc-800 bg-black px-4 py-4 text-sm leading-7 text-zinc-200 whitespace-pre-wrap">{prompt}</code>
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={copyPrompt}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-purple-300 bg-purple-300 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080a]"
        >
          {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          <span>{copyState === "copied" ? "Copied" : "Copy prompt"}</span>
        </button>
        {copyState === "unavailable" ? (
          <p className="inline-flex items-center gap-2 text-sm text-amber-200" role="status">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Copy is unavailable here. Select the visible prompt and copy it manually.
          </p>
        ) : null}
      </div>
    </article>
  )
}

export function ProjectIntakePrompts() {
  return (
    <div className="grid gap-5" aria-label="Project Intake prompts">
      <PromptCard
        label="Step 1 · Read-only"
        title="Confirm the local connection"
        description="Open a copied or non-sensitive project and an active sequence in Premiere. This check does not change the project."
        prompt={safeFirstPrompt}
        promptKind="safe_check"
      />
      <PromptCard
        label="Step 2 · Preview only"
        title="Request the intake review"
        description="Use an approved intake template. The result is a path-redacted report and proposed organization actions—not permission to organize the project."
        prompt={projectIntakePreviewPrompt}
        promptKind="intake_preview"
      />
    </div>
  )
}
