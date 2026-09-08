"use client"

import { useState } from "react"
import { trackOnboardingEvent } from "@/lib/onboarding-events"

export function WorkflowKitActions({
  id,
  prompt,
}: {
  id: string
  prompt: string
}) {
  const [message, setMessage] = useState("")
  async function copy(value: string, kind: "prompt" | "link") {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(
        kind === "prompt"
          ? "Prompt copied. Review it in your assistant before running it."
          : "Recipe link copied. No project information is included.",
      )
      trackOnboardingEvent(
        kind === "prompt"
          ? "onboarding_workflow_prompt_copied"
          : "onboarding_workflow_link_copied",
        { workflow: id },
      )
    } catch {
      setMessage(
        "Copy is unavailable. Select the prompt below, or copy the recipe link address.",
      )
    }
  }
  const recipeUrl = `https://premiere-pro-mcp.com/workflows/#${id}`
  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => copy(prompt, "prompt")}
          className="min-h-12 rounded-md bg-violet-200 px-5 py-3 font-semibold text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
        >
          Copy starter prompt
        </button>
        <button
          type="button"
          onClick={() => copy(recipeUrl, "link")}
          className="min-h-12 rounded-md border border-zinc-600 px-5 py-3 font-medium text-zinc-100 hover:border-violet-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
        >
          Copy recipe link
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="mt-3 min-h-12 text-sm leading-6 text-violet-200"
      >
        {message}
      </p>
      <details className="rounded-lg border border-zinc-700 p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-zinc-100">
          Read the starter prompt
        </summary>
        <p className="mt-3 select-text whitespace-pre-wrap break-words leading-7 text-zinc-300">
          {prompt}
        </p>
      </details>
      <a
        href={recipeUrl}
        className="mt-2 inline-flex min-h-11 items-center text-sm text-violet-200 underline underline-offset-4"
      >
        Permanent recipe link
      </a>
    </div>
  )
}
