export type ArticleSection = {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

export type ArticleFaq = {
  question: string
  answer: string
}

export type Article = {
  slug: string
  title: string
  description: string
  eyebrow: string
  publishedAt: string
  modifiedAt: string
  readingTime: string
  keywords: string[]
  sections: ArticleSection[]
  faqs: ArticleFaq[]
  resources: Array<{ label: string; href: string }>
}

export const articles: Article[] = [
  {
    slug: "what-is-a-premiere-pro-mcp-server",
    title: "What Is a Premiere Pro MCP Server? A Practical Guide to AI-Assisted Editing",
    description:
      "Learn what a Premiere Pro MCP server does, how it connects a compatible AI assistant to Adobe Premiere Pro, and how to start with a safe read-only check.",
    eyebrow: "Premiere Pro MCP explained",
    publishedAt: "2026-08-19",
    modifiedAt: "2026-08-19",
    readingTime: "7 min read",
    keywords: ["Premiere Pro MCP server", "MCP video editing", "AI assistant for Adobe Premiere Pro"],
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "A Premiere Pro MCP server is a local service that gives a compatible AI assistant a structured way to work with Adobe Premiere Pro. Instead of asking an assistant to guess what is on screen or operate the interface like a person, the server exposes named tools for supported tasks such as inspecting a sequence, organizing media, preparing an edit, applying a supported change, or sending an export to Adobe Media Encoder.",
          "MCP stands for Model Context Protocol, an open standard for connecting AI applications with external tools, data, and workflows. In this case, the external system is a Premiere project running on the editor’s computer. The useful outcome is not “AI edits a video by itself.” It is a more inspectable way to ask for repeatable Premiere work while the editor retains the creative decision and a chance to verify what happened.",
        ],
      },
      {
        heading: "How the connection works",
        paragraphs: [
          "Premiere Pro MCP uses a local-first path: your AI client sends a structured request to a local MCP server, and a local Premiere connector carries supported commands into the open Premiere session. Premiere returns structured data, confirmation, or diagnostics to the client. The recommended setup keeps the server, connector, Premiere, and project media on the same computer.",
          "This architecture matters because a tool listing is not proof that a particular Premiere build can complete a particular operation. A robust workflow starts by checking the connection and available capabilities, then previewing or applying the smallest supported step, then inspecting the returned result. That is more dependable than treating natural-language output as evidence that a timeline changed.",
        ],
        bullets: [
          "AI client: Claude Desktop, Cursor, VS Code / Copilot, Windsurf, or another MCP-compatible client.",
          "Local server: translates structured tool calls into supported Premiere workflows.",
          "Premiere connector: the signed CEP bridge is the default compatibility route; UXP tools are capability-gated on compatible hosts.",
          "Observed result: the client receives returned data, confirmation, or diagnostics instead of a silent best-effort claim.",
        ],
      },
      {
        heading: "What can an AI assistant help with in Premiere Pro?",
        paragraphs: [
          "The server currently registers 287 core structured tools across timeline work, effects and Lumetri color, audio, captions, markers, keyframes, project organization, media and proxy workflows, diagnostics, export, and local editorial planning. The default capability profile exposes 285 of those tools. An authenticated compatible UXP host can add 50 capability-gated tools, bringing the connected surface to 335.",
          "Those numbers describe discovery, not a blanket promise. A better question is whether the current host can perform the specific task you need. For example, an editor might ask for the active sequence and its clip structure before requesting a preview of a B-roll assembly. A post-production lead might ask for a project inventory before standardizing bins. A workflow developer might use the structured surface as a starting point rather than building and maintaining a bridge from scratch.",
        ],
      },
      {
        heading: "What a Premiere Pro MCP server is not",
        paragraphs: [
          "It is not a hosted video editor, a replacement for editorial judgment, or a guarantee that every operation will work in every Premiere version. It does not turn a simulated product demo into proof of a completed edit. The local-first recommendation also does not override the privacy settings of the AI client you choose.",
          "That boundary is a feature, not a footnote. Repeatable automation is most useful when an editor can set the goal, review the plan, limit authority, and inspect the outcome. For unusual, destructive, or version-sensitive work, use a small test sequence and verify state before relying on a larger batch.",
        ],
      },
      {
        heading: "A safe first prompt",
        paragraphs: [
          "After installing the assistant bundle or local server and the separate Premiere connector, restart both applications, open a project, and run a read-only connection check. This establishes whether the client can reach the live Premiere bridge before an editing request enters the picture.",
          "Use this exact first request: “Safely check my Premiere connection with verify_premiere_connection. Make no changes.” If it succeeds, ask the assistant to inspect the active project or sequence before you progress to a supported edit. If it returns a diagnostic, resolve that first instead of retrying an edit blindly.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does Premiere Pro MCP upload my footage?",
        answer:
          "The recommended setup is local-first: the server, Premiere connector, Premiere app, and project media stay on the editor’s computer. Your chosen AI client has its own privacy behavior and settings, so review those separately.",
      },
      {
        question: "Does it work with every AI assistant?",
        answer:
          "It works with MCP-compatible clients. Claude Desktop has a released bundle; other clients can use the local server through their MCP configuration. A native one-click installer is not currently shipped for every client.",
      },
      {
        question: "Will every Premiere tool work on my machine?",
        answer:
          "No static list can prove a live host operation. Run the read-only connection check, inspect capabilities, start with a small supported task, and verify the returned state or diagnostics.",
      },
    ],
    resources: [
      { label: "Read the setup and technical guide", href: "/docs/" },
      { label: "View the open-source repository", href: "https://github.com/leancoderkavy/premiere-pro-mcp" },
      { label: "Read the Model Context Protocol introduction", href: "https://modelcontextprotocol.io/docs/getting-started/intro" },
    ],
  },
  {
    slug: "ai-video-editing-with-premiere-pro",
    title: "AI Video Editing with Premiere Pro: Keep Creative Control, Automate the Repetitive Work",
    description:
      "A practical approach to AI video editing in Adobe Premiere Pro: inspect first, automate repeatable work with structured tools, and verify every result.",
    eyebrow: "AI video editing workflow",
    publishedAt: "2026-08-19",
    modifiedAt: "2026-08-19",
    readingTime: "8 min read",
    keywords: ["AI video editing Premiere Pro", "Adobe Premiere Pro AI workflow", "AI assistant video editing"],
    sections: [
      {
        heading: "AI editing is most useful when it removes friction, not authorship",
        paragraphs: [
          "Editors do not need another tool that makes an opaque promise to “edit a video.” They need help with the parts of post-production that are repetitive, easy to describe, and expensive to repeat: taking inventory of a project, creating a sequence from known clips, lining up B-roll, applying a repeatable treatment, organizing bins, preparing markers, or queuing a delivery preset.",
          "Adobe Premiere already includes its own evolving AI features. An MCP workflow solves a different problem: it lets a compatible AI assistant work with an existing local Premiere project through named, structured tools. The assistant can help turn a goal into a sequence of supported steps, while the editor stays responsible for taste, story, pacing, and final approval.",
        ],
      },
      {
        heading: "Use a four-stage workflow: inspect, plan, apply, verify",
        paragraphs: [
          "The fastest-looking prompt is not always the safest one. Begin by asking the assistant to inspect the project and active sequence without changing anything. That establishes clip names, tracks, timing, and the current state that a later edit depends on.",
          "Next, ask for a bounded plan or preview. Name the target sequence, tracks, clips, timing constraints, and desired output. Apply only the supported steps you understand, then inspect the returned state or diagnostics. This keeps the work legible when a Premiere host differs from another machine, when a tool needs a specific capability, or when an operation cannot be confirmed.",
        ],
        bullets: [
          "Inspect: “Show the active sequence, tracks, and clips. Make no changes.”",
          "Plan: “Create a proposed B-roll assembly on V2 using these named clips. Do not apply it yet.”",
          "Apply: approve the bounded operation only after the target and intent are clear.",
          "Verify: re-read the sequence, inspect the expected values, or review the explicit export result.",
        ],
      },
      {
        heading: "Good AI-assisted Premiere tasks start with a clear definition of done",
        paragraphs: [
          "Natural language is useful for intent, but video timelines are precise. A request such as “make this more engaging” asks the assistant to invent editorial taste. A request such as “place these four B-roll clips on V2 over the interview section, preserve A1, add a cross dissolve between the B-roll clips, and prepare a 1080p ProRes export” gives it constraints that can be inspected.",
          "Use names, tracks, time ranges, desired effects, output presets, and no-change boundaries. When a task is sensitive, split it into stages. For example, first collect the clips and report the plan; then let the editor approve the assembly; then apply the color or export pass. Smaller stages are easier to review and easier to recover from.",
        ],
      },
      {
        heading: "Where an MCP workflow fits",
        paragraphs: [
          "Premiere Pro MCP is free, MIT-licensed, and designed for local-first use. It registers 287 core tools for project inspection, timeline editing, effects, color, audio, media management, diagnostics, export, and review-only editorial planning. The default profile deliberately limits the surface to 285 tools; a compatible authenticated UXP host can add 49 capability-gated tools. These boundaries let the client report what is available rather than pretending that every supported feature is ready at every moment.",
          "For an editor, the key benefit is repeatability without moving the project into a separate hosted editor. For a team, it is a consistent way to ask for and check common operations. For a workflow developer, it is a maintained bridge and structured discovery surface instead of a screen-reading macro.",
        ],
      },
      {
        heading: "Protect the project before the convenience",
        paragraphs: [
          "Use a duplicate project or a small test sequence when trying a new operation. Keep destructive and unsafe capabilities disabled unless you explicitly need them. Re-query the timeline after a mutation, and do not treat an attempted command as a verified change. The right response to a capability error or diagnostic is to understand it, not to repeat the request until something changes.",
          "That does not make the workflow slow. It turns review into part of the loop: the assistant handles the mechanical steps, and the editor maintains authorship. The result is a more dependable use of AI in Premiere, especially for work that needs to be repeated across projects or collaborators.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can AI make my creative decisions for me?",
        answer:
          "It can help execute clearly specified, supported tasks, but editorial taste, story, pacing, and final approval remain human decisions. The most reliable requests include concrete constraints and a verification step.",
      },
      {
        question: "Can I start without changing my project?",
        answer:
          "Yes. Start with the read-only verify_premiere_connection prompt, then inspect the project and active sequence. Ask for a preview or plan before applying any supported edit.",
      },
      {
        question: "Is Premiere Pro MCP Adobe’s AI Assistant?",
        answer:
          "No. Premiere Pro MCP is an independent, open-source MCP server that works through a local Premiere connection. Adobe’s own AI features and their availability are separate products and workflows.",
      },
    ],
    resources: [
      { label: "Install and run a safe first check", href: "/docs/" },
      { label: "Learn about Adobe Premiere’s AI Assistant", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html" },
      { label: "Read how a Premiere Pro MCP server works", href: "/blog/what-is-a-premiere-pro-mcp-server/" },
    ],
  },
  {
    slug: "premiere-pro-workflow-automation",
    title: "Premiere Pro Workflow Automation: Repeat the Work, Not the Edit",
    description:
      "See which Adobe Premiere Pro tasks are good candidates for workflow automation, how to keep edits reviewable, and how to verify an AI-assisted result.",
    eyebrow: "Premiere Pro automation",
    publishedAt: "2026-08-19",
    modifiedAt: "2026-08-19",
    readingTime: "7 min read",
    keywords: ["Premiere Pro workflow automation", "Premiere Pro automation", "automate video editing workflow"],
    sections: [
      {
        heading: "Automate the repeated parts of post-production",
        paragraphs: [
          "Premiere Pro workflow automation works best when the job is repeatable, the inputs are known, and the outcome can be checked. That includes creating a project inventory, organizing bins to a defined structure, inspecting an active sequence, applying a documented treatment, preparing markers or captions, checking proxy state, and queuing an export with a chosen preset.",
          "The point is not to erase the editor. It is to remove the friction between a clear request and a verifiable result. A good automation gives the team more time for the decisions a computer should not make: what matters in an interview, how a scene should breathe, which take carries the story, and when the cut is finished.",
        ],
      },
      {
        heading: "Choose tasks that have clear inputs, constraints, and output",
        paragraphs: [
          "A task is a strong automation candidate when you can describe the source, the target, the constraints, and the expected state afterward. “Create a review sequence from the selected clips in this bin, place them on V1 in the listed order, and preserve all audio tracks” is inspectable. “Fix the pacing” is not—at least not without an editor deciding what that means.",
          "This distinction makes automation easier to trust. If a tool cannot find the named clips, does not have the required capability, or cannot verify the outcome, it should return a useful diagnostic. It should not silently substitute a different target or claim success because it attempted a command.",
        ],
        bullets: [
          "Strong candidates: media inventory, bin organization, project and sequence setup, repetitive timeline placement, known effect settings, proxy checks, marker work, and delivery preparation.",
          "Needs editorial review: shot selection, story structure, performance judgments, comedic timing, music taste, and brand-sensitive creative choices.",
          "Needs extra care: destructive batches, incomplete source media, undocumented host behavior, and operations that affect shared project files.",
        ],
      },
      {
        heading: "A reliable automation loop",
        paragraphs: [
          "Start with a no-change connection and project check. Then provide a bounded request that names the project or sequence, the target tracks, inputs, and the expected output. Where a preview is available, ask for it before applying the change. Afterward, inspect the state or the terminal receipt rather than relying on a conversational confirmation.",
          "That loop works whether you are a solo editor preparing social versions or a workflow lead standardizing a repeated delivery step. It also generates useful evidence for debugging: if a host returns a capability error, you know whether the issue is installation, version support, authority, or an incorrect target.",
        ],
      },
      {
        heading: "Why structured tools are better than UI guessing",
        paragraphs: [
          "Traditional macros and screen-driven automation infer state from a changing interface. Panels move, workspaces differ, dialogs steal focus, and a visible click does not always prove the project changed. A structured MCP tool surface can expose specific actions and return data or diagnostics about the request.",
          "Premiere Pro MCP combines that structure with a local-first bridge. The server registers 287 core tools, with capabilities and authority reported separately from static tool support. That matters when different Premiere versions, permission settings, and connection states change what is safe to run. The correct path is to discover the available surface and verify the particular operation at call time.",
        ],
      },
      {
        heading: "Start with one workflow you already repeat",
        paragraphs: [
          "Pick a workflow that happens every week and has a simple success condition. It might be creating a consistent bin layout for incoming footage, placing approved selects onto a review sequence, preparing a proxy report, or queueing a standard export. Write the steps as you would hand them to a careful assistant, including what must not change.",
          "Install the local server and Premiere connector, run the read-only connection check, and try the workflow on a duplicate project or small test sequence. Once the returned state matches expectations, keep the prompt as a team-ready recipe. Building confidence one bounded workflow at a time is more valuable than asking for an all-purpose autonomous edit.",
        ],
      },
    ],
    faqs: [
      {
        question: "What Premiere Pro tasks should I automate first?",
        answer:
          "Start with a frequent, low-risk task that has a concrete outcome: project inventory, bin organization, known timeline placement, proxy checking, marker preparation, or a standard export setup.",
      },
      {
        question: "How do I know an automated edit worked?",
        answer:
          "Ask the assistant to inspect the resulting sequence or project state, and review returned confirmation or diagnostics. Do not rely on a tool call having been attempted as evidence that it succeeded.",
      },
      {
        question: "Can I run the server remotely?",
        answer:
          "A remote HTTP transport exists, but it requires authentication and a functioning connection to the local Premiere bridge. The local setup is the recommended route for most editors.",
      },
    ],
    resources: [
      { label: "See the supported capability categories", href: "/docs/" },
      { label: "Read the full README and setup guidance", href: "https://github.com/leancoderkavy/premiere-pro-mcp#readme" },
      { label: "Explore AI-assisted Premiere workflows", href: "/blog/ai-video-editing-with-premiere-pro/" },
    ],
  },
]

export const articleBySlug = new Map(articles.map((article) => [article.slug, article]))
