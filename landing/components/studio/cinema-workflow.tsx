"use client"

import { ArrowDown, ArrowRight, Check, MessageSquare, Scissors, Flag, Workflow } from "lucide-react"
import type { CinemaEditor } from "./cinema-editor"

export function CinemaWorkflow({ editor }: { editor: CinemaEditor }) {
  const { phase, plan, busy } = editor
  return (
    <div className="cinema-workflow" aria-label="Try the MCP editing workflow">
      <div className="cinema-workflow-heading">
        <div>
          <span className="cinema-eyebrow">FROM INTENTION TO EDIT</span>
          <h2>Say the edit. See it happen.</h2>
        </div>
        <span className="cinema-demo-label">Interactive demo · sample media</span>
      </div>
      <div className="cinema-signal-path" data-phase={phase}>
        <div className="cinema-signal-node" data-active={phase === 1}>
          <span className="cinema-node-icon">
            <MessageSquare size={17} />
          </span>
          <div>
            <h3>You + your assistant</h3>
            <p>{plan ? `“${plan.prompt}”` : "Describe the change in plain language."}</p>
          </div>
        </div>
        <ArrowRight className="cinema-signal-arrow" size={18} aria-hidden="true" />
        <div className="cinema-signal-node" data-active={phase === 2}>
          <span className="cinema-node-icon">
            <Workflow size={18} />
          </span>
          <div>
            <h3>MCP + local bridge</h3>
            <p>{plan?.tools ?? "Reads your sequence. Sends editing tools to Premiere."}</p>
          </div>
        </div>
        <ArrowRight className="cinema-signal-arrow" size={18} aria-hidden="true" />
        <div className="cinema-signal-node" data-active={phase >= 3}>
          <span className="cinema-node-icon cinema-premiere-icon">Pr</span>
          <div>
            <h3>Adobe Premiere Pro</h3>
            <p>
              {phase === 4
                ? "The assistant reads back the result. Your edit stays editable."
                : "Applies the edit and returns the updated timeline."}
            </p>
          </div>
        </div>
      </div>
      <div className="cinema-request-row" role="group" aria-label="Try an editing request">
        <span>
          TRY A REQUEST <ArrowDown size={12} aria-hidden="true" />
        </span>
        <button type="button" disabled={busy} onClick={() => editor.request("trim")}>
          <Scissors size={14} />
          Trim opening to 4s
        </button>
        <button type="button" disabled={busy} onClick={() => editor.request("reorder")}>
          <ArrowRight size={14} />
          Put the blue shot first
        </button>
        <button type="button" disabled={busy} onClick={() => editor.request("marker")}>
          <Flag size={14} />
          Mark this frame
        </button>
      </div>
      <div className="cinema-workflow-status" role="status" aria-live="polite" aria-atomic="true">
        {phase === 4 ? (
          <Check size={14} />
        ) : (
          <span className="cinema-status-dot" data-busy={busy} />
        )}
        <span>{editor.notice}</span>
      </div>
      <div className="cinema-demo-footnote">
        <span>
          Runs in your browser. Connect your assistant to Premiere to use these tools on your
          projects.
        </span>
        {plan ? (
          <details className="cinema-tool-details">
            <summary>See example tool calls</summary>
            <div>
              <p>Scripted illustration · sample clip IDs · no live Premiere connection</p>
              <pre>
                {plan.calls
                  .map(
                    (call, index) =>
                      `${index + 1}. ${call.tool}\n${JSON.stringify(call.arguments, null, 2)}`
                  )
                  .join("\n\n")}
              </pre>
            </div>
          </details>
        ) : (
          <a href="/docs/">
            How to connect <ArrowRight size={12} />
          </a>
        )}
      </div>
    </div>
  )
}
