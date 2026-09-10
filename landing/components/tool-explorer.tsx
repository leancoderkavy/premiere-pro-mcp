"use client"

import { useState } from "react"
import { filterTools, toolSurfaces, type ReferenceTool } from "@/lib/tool-reference"

export function ToolExplorer({ tools }: { tools: ReferenceTool[] }) {
  const [query, setQuery] = useState("")
  const [surface, setSurface] = useState("all")
  const visible = filterTools(tools, query, surface)

  return (
    <section aria-labelledby="tool-search-heading" className="py-10">
      <h2 id="tool-search-heading" className="text-2xl font-semibold">Search the tool reference</h2>
      <p id="tool-search-help" className="mt-3 text-sm leading-7 text-zinc-400">Search by name, task, or mode. Search stays in your browser. Default-profile tools can make edits; availability is not permission to run them.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_15rem]">
        <label className="text-sm font-medium text-zinc-200">
          Find a tool
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-describedby="tool-search-help" placeholder="Try captions, export, or project info" className="mt-2 min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-purple-300" />
        </label>
        <label className="text-sm font-medium text-zinc-200">
          Availability
          <select value={surface} onChange={(event) => setSurface(event.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-purple-300">
            <option value="all">All source tools</option>
            {Object.entries(toolSurfaces).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <noscript><p className="mt-4 text-zinc-300">Interactive filters need JavaScript. All tool descriptions are available below; use your browser&apos;s Find command.</p></noscript>
      <div className="flex min-h-14 flex-wrap items-center gap-4 py-3 text-sm">
        <p role="status" aria-live="polite" className="text-zinc-400">{visible.length} of {tools.length} source entries</p>
        {(query || surface !== "all") && <button type="button" onClick={() => { setQuery(""); setSurface("all") }} className="min-h-11 text-purple-200 underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-purple-300">Clear filters</button>}
      </div>
      {visible.length === 0 && <p className="rounded-lg border border-zinc-800 p-6 text-zinc-300">No matching tools. Try fewer words or choose another availability filter.</p>}
      <div className="divide-y divide-zinc-800 border-y border-zinc-800">
        {visible.map((tool) => (
          <article id={`tool-${tool.name}`} key={tool.name} className="scroll-mt-8 py-6 target:rounded-lg target:bg-purple-950/25 target:px-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="min-w-0 font-mono text-base font-semibold text-purple-200"><a href={`#tool-${tool.name}`} className="break-all underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-purple-300">{tool.name}</a></h3>
              <span className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{toolSurfaces[tool.surface as keyof typeof toolSurfaces]}</span>
            </div>
            <p className="mt-3 break-words text-sm leading-7 text-zinc-300">{tool.description}</p>
            {tool.modes !== "Single operation" && <p className="mt-2 break-words text-sm leading-7 text-zinc-400"><span className="font-medium text-zinc-200">Actions or modes: </span>{tool.modes}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}
