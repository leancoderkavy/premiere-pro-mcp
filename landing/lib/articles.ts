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
    title: "What Is an MCP Server for Adobe Premiere Pro? A Practical Guide to AI-Assisted Editing",
    description:
      "Learn what an MCP server for Adobe Premiere Pro does, how it connects a compatible AI assistant to Adobe Premiere Pro, and how to start with a safe read-only check.",
    eyebrow: "MCP for Adobe Premiere Pro explained",
    publishedAt: "2026-08-19",
    modifiedAt: "2026-08-19",
    readingTime: "7 min read",
    keywords: ["MCP server for Adobe Premiere Pro", "MCP video editing", "AI assistant for Adobe Premiere Pro"],
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "An MCP server for Adobe Premiere Pro is a local service that gives a compatible AI assistant a structured way to work with Adobe Premiere Pro. Instead of asking an assistant to guess what is on screen or operate the interface like a person, the server exposes named tools for supported tasks such as inspecting a sequence, organizing media, preparing an edit, applying a supported change, or sending an export to Adobe Media Encoder.",
          "MCP stands for Model Context Protocol, an open standard for connecting AI applications with external tools, data, and workflows. In this case, the external system is a Premiere project running on the editor’s computer. The useful outcome is not “AI edits a video by itself.” It is a more inspectable way to ask for repeatable Premiere work while the editor retains the creative decision and a chance to verify what happened.",
        ],
      },
      {
        heading: "How the connection works",
        paragraphs: [
          "MCP for Adobe Premiere Pro uses a local-first path: your AI client sends a structured request to a local MCP server, and a local Premiere connector carries supported commands into the open Premiere session. Premiere returns structured data, confirmation, or diagnostics to the client. The recommended setup keeps the server, connector, Premiere, and project media on the same computer.",
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
          "The server currently registers 288 core structured tools across timeline work, effects and Lumetri color, audio, captions, markers, keyframes, project organization, project-intake preview, media and proxy workflows, diagnostics, export, and local editorial planning. The default capability profile exposes 286 of those tools. An authenticated compatible UXP host can add 50 capability-gated tools, bringing the connected surface to 336.",
          "Those numbers describe discovery, not a blanket promise. A better question is whether the current host can perform the specific task you need. For example, an editor might ask for the active sequence and its clip structure before requesting a preview of a B-roll assembly. A post-production lead might ask for a project inventory before standardizing bins. A workflow developer might use the structured surface as a starting point rather than building and maintaining a bridge from scratch.",
        ],
      },
      {
        heading: "What an MCP server for Adobe Premiere Pro is not",
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
        question: "Does MCP for Adobe Premiere Pro upload my footage?",
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
          "MCP for Adobe Premiere Pro is free, MIT-licensed, and designed for local-first use. It registers 288 core tools for project inspection, project-intake preview, timeline editing, effects, color, audio, media management, diagnostics, export, and review-only editorial planning. The default profile deliberately limits the surface to 286 tools; a compatible authenticated UXP host can add 50 capability-gated tools. These boundaries let the client report what is available rather than pretending that every supported feature is ready at every moment.",
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
        question: "Is MCP for Adobe Premiere Pro Adobe’s AI Assistant?",
        answer:
          "No. MCP for Adobe Premiere Pro is an independent, open-source MCP server that works through a local Premiere connection. Adobe’s own AI features and their availability are separate products and workflows.",
      },
    ],
    resources: [
      { label: "Install and run a safe first check", href: "/docs/" },
      { label: "Learn about Adobe Premiere’s AI Assistant", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html" },
      { label: "Read how an MCP server for Adobe Premiere Pro works", href: "/blog/what-is-a-premiere-pro-mcp-server/" },
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
          "MCP for Adobe Premiere Pro combines that structure with a local-first bridge. The server registers 288 core tools, with capabilities and authority reported separately from static tool support. That matters when different Premiere versions, permission settings, and connection states change what is safe to run. The correct path is to discover the available surface and verify the particular operation at call time.",
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
  {
    slug: "adobe-premiere-ai-assistant-vs-mcp",
    title: "Adobe Premiere Pro AI Assistant vs. MCP: How to Choose an AI Editing Workflow",
    description:
      "Compare Adobe’s in-app AI Assistant with a local MCP workflow: client choice, bounded project context, and reviewable Premiere automation.",
    eyebrow: "Choose the right workflow",
    publishedAt: "2026-08-22",
    modifiedAt: "2026-08-22",
    readingTime: "8 min read",
    keywords: [
      "Adobe Premiere Pro AI Assistant vs MCP",
      "Premiere Pro AI Assistant alternative",
      "Premiere Pro MCP workflow",
      "AI assistant for Adobe Premiere Pro",
    ],
    sections: [
      {
        heading: "These are different ways to bring AI into Premiere",
        paragraphs: [
          "Adobe Premiere Pro AI Assistant and Premiere Pro MCP address related needs, but they are not the same product or control path. Adobe’s assistant is a first-party in-Premiere experience for documented workflows. Premiere Pro MCP is an independent, MIT-licensed server that lets a compatible AI client call structured tools through a local Premiere connection.",
          "The useful comparison is not which product is universally better. Start with the task, the AI client your team prefers, the amount of project context involved, and how much review you need before a change is applied.",
        ],
      },
      {
        heading: "Choose Adobe’s assistant when the in-app experience is the priority",
        paragraphs: [
          "Adobe’s AI Assistant is a sensible first place to look when you want a first-party conversational experience in Premiere and the documented feature fits the task. Its availability and feature scope can change, so check Adobe’s current documentation and test the exact workflow in the Premiere version your team uses.",
          "A public-beta feature list is useful for discovery, but it is not a substitute for testing in the project and host version that matter to your delivery. Use a duplicate project or a small test sequence for any new automation, regardless of which assistant you choose.",
        ],
      },
      {
        heading: "Choose Premiere Pro MCP when client choice and reviewable automation matter",
        paragraphs: [
          "Premiere Pro MCP fits when an assistant is part of a broader editorial or development workflow. Claude Desktop, Cursor, VS Code or Copilot, Windsurf, and other compatible MCP clients can call named Premiere operations, inspect capability information, and receive explicit diagnostics through a recommended local-first setup.",
          "Its project-context flow is deliberately bounded: a client can explicitly capture a local context snapshot, retrieve relevant evidence, create a non-mutating edit-plan candidate, then preview and confirm the plan before an eligible compound edit applies. That is useful when a team wants the request and returned result to be inspectable, not merely conversational.",
        ],
        bullets: [
          "Use the AI client that fits your team’s editorial or development workflow.",
          "Run a read-only connection check before requesting a change.",
          "Capture context only when the client explicitly requests it.",
          "Treat returned state or diagnostics as evidence, not an attempted command as proof.",
        ],
      },
      {
        heading: "Keep privacy and creative control separate from marketing claims",
        paragraphs: [
          "The recommended MCP setup keeps Premiere, its connector, the server, and project media on the same computer. That does not change the privacy settings or data handling of the AI client a team chooses. Review that client separately, and do not treat a local server as a universal privacy guarantee.",
          "Neither approach removes editorial judgment. AI can assist with inspection, organization, documented timeline operations, metadata work, and delivery preparation. Decisions about story, performance, pacing, and taste remain the editor’s job.",
        ],
      },
      {
        heading: "A practical way to evaluate either workflow",
        paragraphs: [
          "Pick one common task with a concrete success condition. Identify what must not change, use a duplicate project or test sequence, and start with the smallest inspectable step. For Premiere Pro MCP, begin with verify_premiere_connection, inspect the active sequence, then use a preview where it is available. For Adobe’s assistant, test the documented feature in the current host before relying on it in a larger project.",
          "The winning workflow is the one that reduces repeated effort while leaving the editor confident about what changed, why it changed, and how to recover if the expected result is not there.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is Premiere Pro MCP affiliated with Adobe or Adobe’s AI Assistant?",
        answer:
          "No. Premiere Pro MCP is an independent, MIT-licensed open-source project. Adobe Premiere Pro and Adobe’s AI Assistant are separate Adobe products and workflows.",
      },
      {
        question: "Which one is better for Premiere Pro automation?",
        answer:
          "It depends on the workflow. Adobe’s assistant suits teams that prefer the supported first-party in-app experience. Premiere Pro MCP suits teams that need a compatible AI client, a local structured control path, and an explicit inspect-plan-preview-verify workflow.",
      },
      {
        question: "Can project context replace an editor’s review?",
        answer:
          "No. Context retrieval and edit plans are evidence tools, not editorial truth. An editor should review the target, preview, returned state, and any diagnostics before relying on a change.",
      },
    ],
    resources: [
      { label: "Read Adobe’s current AI Assistant overview", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html" },
      { label: "Run a safe Premiere connection check", href: "/#install" },
      { label: "Learn what an MCP server does in Premiere", href: "/blog/what-is-a-premiere-pro-mcp-server/" },
    ],
  },
  {
    slug: "claude-desktop-premiere-pro-mcp-setup",
    title: "Claude Desktop + Premiere Pro: Start with a Safe MCP Workflow",
    description:
      "Connect Claude Desktop to Adobe Premiere Pro with the local bundle and CEP connector, then verify the bridge before requesting any supported edit.",
    eyebrow: "Safe Premiere setup",
    publishedAt: "2026-08-22",
    modifiedAt: "2026-08-22",
    readingTime: "6 min read",
    keywords: [
      "Claude Desktop Premiere Pro",
      "Claude Premiere Pro MCP setup",
      "Premiere Pro MCP Claude Desktop",
      "Premiere Pro safe connection check",
    ],
    sections: [
      {
        heading: "The first goal is a verified connection, not an edit",
        paragraphs: [
          "When you connect an AI client to Adobe Premiere Pro, the first useful question is whether the client can reach the open Premiere session without changing a project. That check separates installation or compatibility problems from editing problems and gives you a low-risk place to start.",
          "Premiere Pro MCP provides a self-contained Claude Desktop bundle and a separate Premiere CEP connector. Both need to be installed on the same computer as Premiere. The connector is what carries supported commands between the local server and the open host session.",
        ],
      },
      {
        heading: "Set up the local path",
        paragraphs: [
          "Download the Claude Desktop bundle, install the Premiere connector with a trusted ZXP installer, then fully quit and reopen both Claude Desktop and Premiere. Open a Premiere project and make sure an active sequence is selected before you ask Claude to do anything with it.",
          "The signed CEP connector is the default compatibility route for Premiere Pro 2020–2026 on Windows and macOS. The newer UXP bridge is capability-gated for compatible Premiere 25.6+ workflows, so it does not replace the CEP setup path for a first install.",
        ],
      },
      {
        heading: "Use this exact safe first request",
        paragraphs: [
          "In Claude Desktop, ask: Safely check my Premiere connection with verify_premiere_connection. Make no changes. The request is read-only. It does not ask Premiere to change a sequence, and it does not ask you to upload footage.",
          "If the check returns a connection state, continue by inspecting the active project or sequence. If it returns a diagnostic, resolve that condition before attempting an edit. Repeating a mutating request is not a substitute for understanding whether the connector, host, active project, or capability state is ready.",
        ],
      },
      {
        heading: "Choose a first workflow with a clear definition of done",
        paragraphs: [
          "After the safe check passes, start with a small task that has named inputs and an observable result. Inspecting the active sequence, collecting a project inventory, or asking for a proposed plan is a better first exercise than a large timeline rewrite.",
          "For a supported change, name the sequence, tracks, source clips, expected output, and no-change boundaries. Ask for a preview where available. Then review the returned state or diagnostics before you use the result in a larger project.",
        ],
        bullets: [
          "Good first step: inspect an active sequence without changes.",
          "Good next step: request a bounded preview or plan.",
          "Use extra care: destructive batches, shared projects, and undocumented host behavior.",
        ],
      },
      {
        heading: "Troubleshoot without exposing project data",
        paragraphs: [
          "If the connection check fails, fully reopen both applications, confirm that a project is open with an active sequence, and look for Window → Extensions → MCP Bridge in Premiere. Share the returned connection state or diagnostic with support rather than project media, prompts, project names, or file paths.",
          "Your AI client’s own privacy settings still apply. The local-first recommendation describes the Premiere MCP server and connector path; it does not override how a chosen client handles conversations or data.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do I need Node.js to connect Claude Desktop?",
        answer:
          "The released Claude Desktop bundle includes the local server, so the recommended Claude path does not require a separate Node.js install just to connect. Other clients may use the npm or manual setup route.",
      },
      {
        question: "Does a successful connection check prove every Premiere tool works?",
        answer:
          "No. It confirms the connection path. Inspect current capabilities, keep the task small, and verify the returned state or diagnostics for the specific operation you need.",
      },
      {
        question: "Can I use a client other than Claude Desktop?",
        answer:
          "Yes, if it supports local MCP servers. Cursor, VS Code or Copilot, Windsurf, and other compatible clients use their own guided or advanced setup paths.",
      },
    ],
    resources: [
      { label: "Open the Premiere setup guide", href: "/#install" },
      { label: "Read full technical setup documentation", href: "/docs/" },
      { label: "Understand reviewable Premiere workflows", href: "/blog/premiere-pro-workflow-automation/" },
    ],
  },
]

export const articleBySlug = new Map(articles.map((article) => [article.slug, article]))
