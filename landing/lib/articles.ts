import { product, sourceCatalog } from "./product"
import { connectorSetup, localMcpConfig, localMcpEntry } from "./client-setup"

export type ArticleSection = {
  heading: string
  paragraphs: string[]
  bullets?: string[]
  steps?: string[]
  codeBlocks?: Array<{ label: string; code: string }>
  links?: Array<{ label: string; href: string }>
}

export type ArticleFaq = {
  question: string
  answer: string
}

export type Article = {
  slug: string
  title: string
  seoTitle?: string
  description: string
  eyebrow: string
  publishedAt: string
  modifiedAt: string
  readingTime: string
  keywords: string[]
  sections: ArticleSection[]
  faqs: ArticleFaq[]
  resources: Array<{ label: string; href: string }>
  relatedSlugs?: string[]
  workflowKit?: string
}

export const articles: Article[] = [
  {
    slug: "cursor-premiere-pro-mcp-setup",
    title: "How to Set Up Cursor with Premiere Pro MCP",
    seoTitle: "Cursor Premiere Pro MCP Setup",
    description: "Connect Cursor to local Premiere Pro with a versioned MCP configuration, install the CEP connector, and verify the bridge before editing a project.",
    eyebrow: "Cursor Premiere Pro setup",
    publishedAt: "2026-09-10",
    modifiedAt: "2026-09-10",
    readingTime: "5 min read",
    keywords: ["Cursor Premiere Pro MCP", "Cursor Premiere Pro", "Premiere Pro MCP tools", "Cursor mcp.json"],
    sections: [
      {
        heading: "Use Cursor on the computer running Premiere",
        paragraphs: [
          "Cursor can call this project's local MCP server, which passes supported operations to the separate Premiere connector. Install Cursor, Node.js, the MCP server, and the connector on the computer running your licensed Premiere application. Begin with a disposable project and an active sequence.",
          "This guide uses a local stdio process. A Cursor cloud agent or a remote development environment does not automatically have access to the Premiere project on your desktop. The public product website is not a relay to your workstation.",
        ],
        links: [{ label: "Check release requirements and package provenance", href: "/facts/" }],
      },
      {
        heading: "Install and diagnose the Premiere connector",
        paragraphs: [
          `Use Node.js ${product.nodeVersion}+ and run these commands in a local terminal. Fully quit Premiere before installing its connector. The versioned npm command selects premiere-pro-mcp from leancoderkavy; adobe-premiere-pro-mcp is a separate package whose global executable has the same name.`,
          "Restart Premiere, open Window > Extensions > MCP for Adobe Premiere Pro, and open your test project. The doctor command reports setup diagnostics; it does not prove that Cursor has reached the current Premiere session.",
        ],
        codeBlocks: [{ label: "Install the CEP connector and inspect diagnostics", code: connectorSetup }],
        links: [{ label: "Compare the two Premiere MCP packages", href: "/blog/premiere-pro-mcp-vs-adobe-premiere-pro-mcp/" }],
      },
      {
        heading: "Add one MCP entry to Cursor",
        paragraphs: [
          "Cursor supports project settings in .cursor/mcp.json and user-wide settings in ~/.cursor/mcp.json. Choose one scope. Merge this entry with existing mcpServers rather than replacing the whole file, then enable the server from Cursor's Customize page.",
          "The first run may download the pinned npm release. If you already configured a different Premiere MCP entry, disable it while evaluating this one so the assistant does not receive two overlapping tool sets. Keep each project's connector and configuration together.",
        ],
        codeBlocks: [{ label: "Cursor mcp.json entry for this published package", code: JSON.stringify({ mcpServers: { "premiere-pro-leancoderkavy": { type: "stdio", ...localMcpEntry } } }, null, 2) }],
        links: [{ label: "Cursor's official MCP configuration reference", href: "https://cursor.com/docs/mcp" }],
      },
      {
        heading: "Verify the connection before a timeline edit",
        paragraphs: [
          "In a local Cursor Agent conversation, request the connection tool explicitly. Inspect the returned project, active sequence, connector, and readiness diagnostics. A tool listed by Cursor has been advertised by the server; it is not evidence that the corresponding host action has succeeded.",
          "After the read-only check succeeds, choose a small inspection or preview workflow from the starter kit. Review arguments and results before approving a mutation. The tool reference explains source action names and availability, while your running session determines which calls are available.",
        ],
        codeBlocks: [{ label: "First request in Cursor", code: "Safely check my Premiere connection with verify_premiere_connection. Make no changes." }],
        links: [{ label: "Search tool names and availability", href: "/tools/" }, { label: "Evaluate with synthetic starter media", href: "/workflows/" }],
      },
      {
        heading: "Resolve setup failures from the returned evidence",
        paragraphs: ["Check the failing layer before retrying. Keep screenshots and reports free of private project paths, tokens, and client footage."],
        bullets: [
          "Server cannot start: confirm Node.js and npx are available to the local Cursor process. Restart Cursor after installing Node, and inspect the MCP startup output.",
          "Invalid configuration: check JSON syntax, preserve existing entries, and confirm you edited the intended user or project settings file.",
          "Tools appear but Premiere is disconnected: restart the CEP panel, open a project, and rerun the read-only connection check.",
          "A UXP tool is absent: it requires an authenticated compatible UXP panel with the required host capability. The default CEP setup does not advertise every UXP addition.",
        ],
        links: [{ label: "Follow the connection recovery checklist", href: "/docs/troubleshooting/" }],
      },
    ],
    faqs: [
      { question: "Does Cursor need a remote MCP URL to edit local Premiere?", answer: "No. This guide uses local stdio so Cursor starts the server beside Premiere. The separate CEP connector is still required." },
      { question: "Where does the Cursor MCP configuration go?", answer: "Use .cursor/mcp.json in the project or ~/.cursor/mcp.json for user-wide settings. Choose one scope and preserve existing server entries." },
      { question: "Will the configuration change my Premiere project?", answer: "Adding the server does not itself request an edit. Later tool calls can change a project, so start with verify_premiere_connection and review each proposed operation." },
    ],
    resources: [{ label: "Official Cursor MCP documentation", href: "https://cursor.com/docs/mcp" }, { label: "npm versioned package execution", href: "https://docs.npmjs.com/cli/v11/commands/npx/" }, { label: "Our source repository", href: product.links.repository }],
    relatedSlugs: ["how-to-set-up-premiere-pro-mcp", "codex-premiere-pro-mcp-setup", "premiere-pro-mcp-vs-adobe-premiere-pro-mcp"],
  },
  {
    slug: "premiere-pro-mcp-vs-adobe-premiere-pro-mcp",
    seoTitle: "Compare Two Premiere MCP Packages",
    title: "premiere-pro-mcp vs adobe-premiere-pro-mcp: Packages, Setup, and Workflows",
    description: "Compare leancoderkavy and hetpatel-11's separate Premiere MCP projects, verify the npm package, and evaluate the same workflow before switching.",
    eyebrow: "Package comparison",
    publishedAt: "2026-09-09",
    modifiedAt: "2026-09-10",
    readingTime: "6 min read",
    keywords: ["premiere-pro-mcp vs adobe-premiere-pro-mcp", "Premiere MCP comparison", "hetpatel Premiere MCP", "Premiere MCP package setup"],
    sections: [
      {
        heading: "Two repositories, two packages, one command name",
        paragraphs: [
          "MCP for Adobe Premiere Pro is maintained at leancoderkavy/premiere-pro-mcp and published as premiere-pro-mcp. The separate hetpatel-11/Adobe_Premiere_Pro_MCP repository publishes adobe-premiere-pro-mcp. Installing one package does not install the other project.",
          "Both packages declare an executable named premiere-pro-mcp. A copied command or an existing global executable can therefore be ambiguous. Check the package identity and use the matching connector and client instructions. This comparison is written by the maintainers of the leancoderkavy project. We inspected the other project's README and package metadata at commit ee31c3d on September 9, 2026; we did not run its tools inside Premiere.",
        ],
        codeBlocks: [{ label: "Read public package identity without installing either package", code: "npm view premiere-pro-mcp name version repository.url bin --json\nnpm view adobe-premiere-pro-mcp name version repository.url bin --json" }],
        links: [
          { label: "leancoderkavy repository", href: product.links.repository },
          { label: "hetpatel-11 package at the inspected commit", href: "https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/ee31c3def7c3ca1c68662ea7737a9f8e5a2b634f/package.json" },
        ],
      },
      {
        heading: "Compare workflow scope and evidence",
        paragraphs: [
          `Our published v${product.version} artifact contains ${product.coreToolCount} core tools. Its source includes revision-bound editorial planning, a project-intake preview, review-frame workflows, local media and delivery analysis, and guarded After Effects handoff routes. Those are different kinds of capabilities: a local plan is not a timeline mutation, and an import receipt is not playback or render proof.`,
          "At the inspected commit, hetpatel-11's README describes 283 catalog tools, including search_tools, get_tool_schema, and invoke_tool, plus 13 resources and 10 guided prompts. It emphasizes CEP workflows including product-spot assembly and a live tool sweep. It reports active use and testing on Premiere 26.0 and calls UXP experimental. These are the maintainer's documented claims, not our independent host test results.",
          "The catalog counts use different groupings and are not a feature-quality score. Both projects offer a local CEP route and require a compatible Premiere installation. Evaluate the operations you need, their prerequisites, and what their returned results actually establish.",
        ],
        links: [
          { label: "Our published package facts and provenance", href: "/facts/" },
          { label: "Search our supported action contracts", href: "/tools/" },
          { label: "Other project's README at the inspected commit", href: "https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/ee31c3def7c3ca1c68662ea7737a9f8e5a2b634f/README.md" },
        ],
      },
      {
        heading: "Evaluate the same small project in each",
        paragraphs: ["Use a copied project and the same source media, requested outcome, host version, and operating system for each evaluation. Record the installed package version and connector. Never turn a planned operation or an accepted host response into a completed-edit claim."],
        steps: [
          "Start with verify_premiere_connection and request no changes. Record whether the intended project and sequence are ready.",
          "Inspect one sequence. Compare the report with Premiere and note omissions, stale state, or unsupported operations.",
          "Request one product-spot preview or another bounded workflow. Check source ranges, tracks, prerequisites, and whether approval is required before any writes.",
          "If testing an edit, explicitly approve the exact change in the disposable project. Inspect the timeline, Undo behavior, save/reopen result, and playback separately.",
          "If testing delivery, inspect the exported file separately. Record elapsed time and failures for this fixture; a single run is not a general speed benchmark.",
        ],
        links: [{ label: "Download our synthetic workflow starter kit", href: "/workflows/" }],
      },
      {
        heading: "Switch without mixing configurations",
        paragraphs: [
          "Save a copy of your client configuration and note which package and connector it starts. Stop that MCP entry and its panel before testing a replacement. Follow the chosen repository's installation instructions; do not assume the connectors, environment variables, or tool names are interchangeable.",
          "For this project, the Claude Desktop bundle and its separate Premiere connector are the documented release route. For source users, the new --print-client-config helper emits a client entry pointing at the current Node executable and server file. It writes no files. This helper is a development-source feature and is absent from the published v1.15.0 package.",
          "Merge the generated entry into existing settings and preserve other servers. Its local paths may contain your user name; keep the output private. A moved checkout or Node installation requires a refreshed entry. Restart your client and repeat the read-only connection check before editing.",
        ],
        links: [
          { label: "Release setup guide", href: "/blog/how-to-set-up-premiere-pro-mcp/" },
          { label: "Source configuration helper and commands", href: `${product.links.repository}/blob/main/docs/client-configuration.md` },
          { label: "Connection troubleshooting", href: "/docs/troubleshooting/" },
        ],
      },
      {
        heading: "Share a reproducible result",
        paragraphs: [
          "After a successful evaluation, a useful contribution is a short account of the workflow, package version, OS, Premiere build, expected result, and observed result. Use synthetic material; exclude client media, paths, tokens, and private transcripts from public reports.",
          "If this project is useful to you, a GitHub star helps others discover it. The starter kit, installation, and contribution process remain available without a star. Independent workflow reports are more informative than catalog size alone.",
        ],
        links: [{ label: "View or star our repository", href: product.links.repository }],
      },
    ],
    faqs: [
      { question: "Are premiere-pro-mcp and adobe-premiere-pro-mcp the same package?", answer: "No. premiere-pro-mcp belongs to leancoderkavy/premiere-pro-mcp; adobe-premiere-pro-mcp belongs to hetpatel-11/Adobe_Premiere_Pro_MCP. They both declare a premiere-pro-mcp command, so verify the package and repository before installation." },
      { question: "Does the larger catalog prove that one works better?", answer: "No. Catalog registrations, sub-actions, local plans, and host operations have different scopes. Compare the same workflow on your intended Premiere version and verify the result." },
      { question: "Can either hosted website edit the Premiere project on my computer?", answer: "A website or repository alone cannot establish a local Premiere connection. Follow the selected project's local server and connector setup. This project's hosted endpoint does not automatically pair with a visitor's computer." },
    ],
    resources: [
      { label: "Our npm package", href: product.links.npm },
      { label: "Other project's npm package", href: "https://www.npmjs.com/package/adobe-premiere-pro-mcp" },
      { label: "Our package facts", href: "/facts/" },
      { label: "npm executable mapping", href: "https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin" },
    ],
    relatedSlugs: ["how-to-set-up-premiere-pro-mcp", "premiere-pro-ai-workflow-checklist"],
  },
  {
    slug: "premiere-pro-project-intake-checklist",
    seoTitle: "Project Intake Checklist",
    title: "Premiere Pro Project Intake Checklist: Prepare a Read-Only Review Before Organizing Media",
    description:
      "Use this assistant-editor checklist to prepare a bounded, read-only Premiere Pro Project Intake preview with an approved facility template, clear scope, and review steps.",
    eyebrow: "Project Intake readiness checklist",
    publishedAt: "2026-08-23",
    modifiedAt: "2026-08-23",
    readingTime: "7 min read",
    keywords: [
      "Premiere Pro project intake checklist",
      "assistant editor project intake",
      "Premiere Pro project organization checklist",
      "read-only Premiere Pro project review",
    ],
    sections: [
      {
        heading: "Use this before a Project Intake preview, not after a project changes",
        paragraphs: [
          "A project-intake review is most useful before an assistant editor starts organizing a handoff. It gives the post supervisor and assistant editor a shared way to inspect what is already in an open Premiere project, compare it with an explicit facility template, and decide what needs human attention.",
          "Premiere Pro MCP v1.13.0 includes a preview-only Project Intake tool. It can return a path-redacted report and a proposed organization list, but it does not change Premiere or persist the template. Treat the output as a review artifact, not as proof that a project is ready for delivery or that a future organization action will succeed on every host.",
        ],
      },
      {
        heading: "1. Define the intake decision before you open the assistant",
        paragraphs: [
          "Start with the decision the report should support. For example: can this project enter an assistant-editor handoff, does it follow the team's bin and label policy, or which items need manual review before a conform? A report cannot supply a policy the team has not agreed on.",
          "Keep the first review limited to the open project and the facts the template actually evaluates. Project Intake is not a request to choose selects, judge pacing, scan drives, relink media, attach proxies, create a rough cut, or change a timeline.",
        ],
        bullets: [
          "Name the handoff or review decision the report must support.",
          "Assign a human owner for policy exceptions and final organization decisions.",
          "Use a copied or non-sensitive project when evaluating a new template or host path.",
        ],
      },
      {
        heading: "2. Bring an approved, versioned facility template",
        paragraphs: [
          "The preview evaluates an explicit facility-supplied template; it should not infer your house rules from a project name, a folder name, or a model guess. Before running it, make sure the workflow owner has reviewed the template version and the specific checks it is meant to enforce.",
          "A useful first template focuses on deterministic project organization: expected bin destinations, allowed labels, a naming pattern, and allowlisted metadata fields. Keep rules narrow enough that an assistant editor can explain each finding and a supervisor can reject a proposal that does not fit the real handoff.",
        ],
      },
      {
        heading: "3. Verify the local Premiere path without changing the project",
        paragraphs: [
          "Install the compatible AI client, local server, and separate Premiere connector. Then open the intended project in Premiere and ask: “Safely check my Premiere connection with verify_premiere_connection. Make no changes.”",
          "This read-only first-run check verifies the server, selected bridge, active project, and active sequence without returning project names, paths, or media details. A ready response is not a blanket compatibility guarantee. Resolve any returned diagnostic before asking for a Project Intake preview.",
        ],
      },
      {
        heading: "4. Request the Project Intake preview with the privacy boundary intact",
        paragraphs: [
          "Ask the assistant to use preview_project_intake with the approved template and to return the read-only report plus proposed organization actions. Be explicit that this is a preview: “Evaluate this open Premiere project against our approved intake template. Return the redacted report and proposed organization actions. Do not change Premiere or persist the template.”",
          "Observed media paths are excluded from findings by default. Do not turn on path inclusion merely to make a report more detailed; use the minimum information needed for the review. If the report is marked truncated, treat it as incomplete rather than as a complete project inventory.",
        ],
      },
      {
        heading: "5. Review findings one by one before anyone organizes the project",
        paragraphs: [
          "Compare the report with the project in Premiere and the current facility policy. Confirm that each finding is meaningful, that any proposed action belongs to the right project, and that an exception has an assigned human decision. A proposed organization action is not an approval to mutate a project.",
          "Keep the preview report, template version, and exception decision with the handoff record when your team's policy allows it. Avoid putting project paths, media names, transcripts, prompts, tokens, or secrets into shared workflow notes or analytics.",
        ],
        bullets: [
          "Accept: the report supports a clear handoff decision and no unresolved finding needs action.",
          "Escalate: a policy exception, incomplete report, unexpected item, or unsupported check needs a workflow owner.",
          "Stop: the connection diagnostic, project identity, or review scope is unclear.",
        ],
      },
      {
        heading: "6. Keep preview evidence separate from real-host proof",
        paragraphs: [
          "The v1.13.0 Project Intake workflow is preview-only. Its automated tests and structured report are useful engineering evidence, but they do not establish that every Premiere version, operating system, client, or future organization action has been validated in a licensed host.",
          "Use the preview to make the handoff discussion more concrete. Keep any later mutating workflow behind its own capability, confirmation, and host-observable verification steps. Do not describe a preview report as a finished organization pass, visual-quality check, or delivery approval.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does preview_project_intake change my Premiere project?",
        answer:
          "No. The v1.13.0 tool returns a read-only, path-redacted intake report and a non-mutating organization proposal. It does not change Premiere or persist the facility template.",
      },
      {
        question: "What should a facility template cover first?",
        answer:
          "Start with narrow, deterministic organization rules that a workflow owner has approved, such as expected bin destinations, allowed labels, a naming pattern, and allowlisted metadata fields. Do not ask it to infer editorial taste or unapproved policy.",
      },
      {
        question: "Does a clean Project Intake report prove the project is ready?",
        answer:
          "No. It reports the bounded checks in the supplied template. Treat truncation, unavailable evidence, unsupported checks, and any policy exception as a reason to review the project before relying on the report.",
      },
    ],
    resources: [
      { label: "Install and run a safe connection check", href: "/#install" },
      { label: "Read the supported Project Intake action", href: "https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/docs/supported-actions.md" },
      { label: "Use the broader Premiere AI workflow checklist", href: "/blog/premiere-pro-ai-workflow-checklist/" },
    ],
  },
  {
    slug: "premiere-pro-project-backup-checklist",
    seoTitle: "Project Backup Checklist",
    title: "Premiere Pro Project Backup Checklist: Make a Verifiable Copy Before High-Risk Changes",
    description:
      "Use this practical checklist to create and verify a separate Premiere Pro project backup before testing automation, major reorganization, or a delivery-critical change.",
    eyebrow: "Project backup checklist",
    publishedAt: "2026-08-23",
    modifiedAt: "2026-08-23",
    readingTime: "6 min read",
    keywords: [
      "Premiere Pro project backup",
      "Premiere Pro backup checklist",
      "Premiere Pro automation safety",
      "Premiere Pro project recovery",
    ],
    sections: [
      {
        heading: "A backup is a recovery boundary, not a promise that an edit will work",
        paragraphs: [
          "Before you test a new automation, change project organization, or hand a project to another workflow, create a separate copy that you can identify and reopen. A backup gives the editor a concrete recovery point. It does not certify the current cut, validate media links, replace a version-control policy, or make an untested automation safe.",
          "Start with the exact project file that should be recoverable. If Premiere has unsaved work, save it first and decide whether that saved state is the point you need to preserve. Keep a human owner for the project and use a duplicate or non-critical project while evaluating a new host, connector, or workflow.",
        ],
      },
      {
        heading: "1. Name the change you are protecting against",
        paragraphs: [
          "Write down the next operation and its boundary before copying anything. Examples include a bulk bin cleanup, a test of a new MCP client, a timeline restructuring pass, or a delivery-preflight experiment. State which project or sequence must remain untouched and who decides whether to continue or roll back.",
          "Do not use a backup as a reason to issue a broad instruction such as “fix the project.” The safer next step is still a bounded request with named inputs, a no-change boundary, and a result you can inspect.",
        ],
        bullets: [
          "Record the project file and the saved state you intend to protect.",
          "Describe the one workflow you are about to test.",
          "Choose a human owner for exceptions, rollback, and final editorial decisions.",
        ],
      },
      {
        heading: "2. Create a separate copy without opening or changing the source file",
        paragraphs: [
          "Premiere Pro MCP includes create_project_backup for an existing .prproj file. It creates a collision-safe copy beside the source and returns byte-verification evidence for the copy. The operation does not open the project in Premiere or modify the source project file.",
          "Ask for the returned backup path and verification details, then keep them with the handoff record if your team permits it. File paths and project names can be sensitive, so do not paste them into public issue reports, analytics, or a shared prompt history unless that disclosure is appropriate.",
        ],
      },
      {
        heading: "3. Check the evidence, then test the smallest possible workflow",
        paragraphs: [
          "A successful backup result means the new copy was created and byte-verified against the source at that moment. It does not establish that the project will open successfully in every Premiere version, that media will relink, or that the next requested edit is appropriate. Open and inspect the copy in the actual host before you rely on it as a recovery route.",
          "For a local MCP setup, next run the read-only connection check and inspect the active sequence. Request a preview or plan before a meaningful edit. When an operation returns a diagnostic or a partial result, stop and resolve that condition rather than assuming a backup makes a retry harmless.",
        ],
      },
      {
        heading: "4. Preserve the record until the owner accepts the result",
        paragraphs: [
          "Keep the original project, the backup reference, the requested workflow, and the reviewer decision together long enough to recover from a late-discovered problem. In a shared environment, use your facility’s naming, storage, and retention rules rather than inventing a new archive policy in an AI prompt.",
          "Once the work is accepted, follow the team’s normal retention policy. A byte-verified project-file backup is useful evidence about that file copy; it is not a substitute for checking media availability, sequence contents, export artifacts, or creative quality.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does create_project_backup change the source Premiere project?",
        answer:
          "No. It creates a separate, collision-safe copy of an existing .prproj file and does not open or modify the source project file.",
      },
      {
        question: "Does byte verification prove the backup will open in Premiere?",
        answer:
          "No. It verifies that the created copy matches the source file bytes at creation time. Open the copy in the relevant Premiere host and inspect its media and sequence state before treating it as a usable recovery point.",
      },
      {
        question: "Should a backup replace a preview or confirmation step?",
        answer:
          "No. Keep the edit itself bounded: inspect the target, request a preview where available, confirm meaningful changes, and review the returned state or diagnostic.",
      },
    ],
    resources: [
      { label: "Read the supported recovery actions", href: "https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/docs/supported-actions.md" },
      { label: "Evaluate an AI workflow before it changes a project", href: "/blog/premiere-pro-ai-workflow-checklist/" },
      { label: "Prepare a read-only project-intake review", href: "/blog/premiere-pro-project-intake-checklist/" },
    ],
    relatedSlugs: ["premiere-pro-project-intake-checklist", "premiere-pro-ai-workflow-checklist"],
  },
  {
    slug: "premiere-pro-review-frames-and-scene-detection",
    seoTitle: "Review Frames & Scene Detection",
    workflowKit: "review-frames",
    title: "Premiere Pro Review Frames and Scene Detection: Build a Faster Human Review Pass",
    description:
      "Create a bounded Premiere Pro review pass with file-verified sequence frames, clip midpoint samples, and source-relative scene-change candidates—without mistaking samples for editorial approval.",
    eyebrow: "Visual review workflow",
    publishedAt: "2026-08-23",
    modifiedAt: "2026-09-04",
    readingTime: "7 min read",
    keywords: [
      "Premiere Pro review frames",
      "Premiere Pro scene detection workflow",
      "Premiere Pro visual QC",
      "Premiere Pro clip review checklist",
    ],
    sections: [
      { heading: "Try this with disposable sample media", paragraphs: ["The downloadable workflow starter kit contains two synthetic video clips, a caption sample, and step-by-step evaluation prompts. Build a disposable sequence and compare the result with the checklist. The kit is not a recorded demonstration or a verified Premiere project; report any failed or unsupported check accurately."], bullets: ["Install the server and separate Premiere connector before trying the kit.", "Start with a read-only connection check and stop if it is not ready.", "Keep file exports and project changes behind their own explicit confirmation."] },
      {
        heading: "Use sampled frames to focus an editor’s review, not to replace it",
        paragraphs: [
          "A long sequence can make a first review slow, especially when the question is structural: are the intended clips present, did a graphic land in the right region, or where should an editor look more closely? A small, clearly scoped set of stills can make that human review faster without pretending to judge pacing, story, color, audio, or playback.",
          "Keep the review question narrow before generating frames. For example: review a 30-second sponsor cut for visible slate frames, compare the midpoint of each clip on V1, or identify likely source changes before an assistant editor logs a file. The output is evidence to review, not a pass/fail editorial verdict.",
        ],
      },
      {
        heading: "1. Sample an active sequence at a defined range",
        paragraphs: [
          "export_sequence_review_frames can write 2–24 evenly spaced frames from a chosen range in the active sequence. The bridge verifies each returned frame path on disk, so a reviewer can tell whether a requested sample was produced rather than relying only on an export request.",
          "Frames are still samples. They do not prove smooth playback, correct audio, all edit points, intentional timing, or visual quality across the whole sequence. Use them to decide what deserves playback review in Premiere, and note any requested frame that was not returned.",
        ],
      },
      {
        heading: "2. Review a track clip by clip when coverage matters",
        paragraphs: [
          "For a focused track review, export_sequence_clip_review_frames can produce one composite midpoint frame for each selected video-track clip, within its configured limit. That is useful for a quick handoff or a graphics pass where the reviewer needs a representative view of each clip boundary without muting other tracks or changing the sequence.",
          "A midpoint frame can miss a problem at a cut, animation, transition, or end frame. Treat every still as an orientation aid. Open the relevant timing region in Premiere whenever the frame raises a question or when the delivery requirement depends on motion, audio, or timing.",
        ],
      },
      {
        heading: "3. Use source scene changes as candidates, not timeline edits",
        paragraphs: [
          "detect_source_scene_changes analyzes a local source file with FFmpeg and returns probable visual-change times. Its timestamps are source-relative candidates; it does not add cuts, markers, subclips, or timeline edits in Premiere.",
          "Start with a conservative threshold, inspect a few candidates in the source monitor, and record which ones are useful for the actual task. A scene-score change can reflect a flash, exposure shift, camera motion, or compression artifact, so it is not the same thing as an approved editorial cut.",
        ],
      },
      {
        heading: "4. Turn samples into a review decision",
        paragraphs: [
          "Give the reviewer a short checklist: the requested range or track, the returned frame paths, the question being reviewed, unresolved samples, and the next human action. Keep the decision language clear: accept the sample set for deeper playback review, escalate a suspected problem, or stop because the intended range is unclear.",
          "Do not put project paths, clip names, transcripts, client notes, or source media in public review records. The MCP path can keep work local, but the privacy behavior of the chosen AI client and the team’s sharing tools still needs its own review.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do review frames prove a sequence is ready to deliver?",
        answer:
          "No. The returned frame files show that selected stills were written. They do not prove playback, audio, timing, color, captions, visual quality, or editorial quality across the sequence.",
      },
      {
        question: "Does source scene detection create edits in Premiere?",
        answer:
          "No. detect_source_scene_changes is read-only local source-file analysis. It returns candidate source-relative times and does not cut or otherwise modify a Premiere timeline.",
      },
      {
        question: "What should happen when a frame is missing or suspicious?",
        answer:
          "Treat the sample set as incomplete or needing review. Inspect the relevant sequence region in Premiere before deciding whether to rerun a bounded request or escalate the issue.",
      },
    ],
    resources: [
      { label: "Review a delivery file with bounded local QC", href: "/blog/premiere-pro-delivery-qc-and-loudness-checklist/" },
      { label: "See the supported review and detection actions", href: "https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/docs/supported-actions.md" },
      { label: "Use the broader AI workflow checklist", href: "/blog/premiere-pro-ai-workflow-checklist/" },
    ],
    relatedSlugs: ["premiere-pro-delivery-qc-and-loudness-checklist", "premiere-pro-ai-workflow-checklist"],
  },
  {
    slug: "premiere-pro-delivery-qc-and-loudness-checklist",
    seoTitle: "Delivery QC & Loudness Checklist",
    title: "Premiere Pro Delivery QC and Loudness Checklist: Inspect the Exact File Before Handoff",
    description:
      "Use a practical delivery checklist for black and freeze findings, loudness measurement, and non-overwriting normalization—while keeping subjective mix and editorial approval with a human reviewer.",
    eyebrow: "Delivery QC checklist",
    publishedAt: "2026-08-23",
    modifiedAt: "2026-08-23",
    readingTime: "8 min read",
    keywords: [
      "Premiere Pro delivery QC checklist",
      "Premiere Pro loudness check",
      "Premiere Pro black frame detection",
      "Premiere Pro frozen frame QC",
    ],
    sections: [
      {
        heading: "Check the delivered file, not a vague idea of the sequence",
        paragraphs: [
          "A delivery review is strongest when every finding points to the exact local file being handed off. The sequence, an Adobe Media Encoder job, and a file on disk are related but different things. Make the file path, intended destination, review owner, and technical thresholds explicit before you ask an assistant to inspect anything.",
          "This checklist helps surface a few bounded signals. It does not replace a broadcaster, platform, client, or facility specification; it does not guarantee compliance; and it does not decide whether an intentional fade, slate, still, or creative audio choice is acceptable.",
        ],
      },
      {
        heading: "1. Preserve the exact file and review boundary",
        paragraphs: [
          "After rendering, identify the exact output file and keep it unchanged while it is being reviewed. Do not substitute a source clip, a previous export, or an assumed Media Encoder receipt for the actual delivery file. If the file must be regenerated, start the review again against the new output.",
          "Record the chosen delivery requirements in plain language. A streaming upload, podcast, social cutdown, and broadcast master can use different loudness targets and technical rules. The workflow should measure against a target supplied by the responsible delivery owner rather than inventing one.",
        ],
      },
      {
        heading: "2. Scan for sustained black and frozen sections",
        paragraphs: [
          "analyze_video_qc runs a read-only FFmpeg scan against a local video file. It reports sustained black and frozen sections using thresholds you choose. It does not contact Premiere, change the file, or prove that an export plays correctly in every player.",
          "Review every finding in context. Intentional fades, slates, still photography, end cards, and deliberate freeze frames can be valid. An empty finding list is also narrow evidence: it says the scan did not find sections at the configured thresholds, not that the delivery is visually or editorially approved.",
        ],
      },
      {
        heading: "3. Measure loudness and true peak on that same file",
        paragraphs: [
          "analyze_loudness measures integrated loudness, loudness range, and true peak from a local audio or video file using FFmpeg’s EBU R128 filter. Supply the target and tolerance that apply to the intended delivery, then keep the returned measurement with the file under review.",
          "The measurement is local decoded-media evidence. It does not prove a Premiere sequence mix, a client’s subjective approval, rights clearance, dialogue intelligibility, or compliance with every destination-specific rule. FFmpeg must be available on the local machine for this measurement path.",
        ],
      },
      {
        heading: "4. Normalize only into a new derivative, then remeasure it",
        paragraphs: [
          "If the delivery owner approves a normalization experiment, normalize_loudness_file requires a new output path and refuses to overwrite the source or an existing output. It remeasures the newly written derivative and reports whether the requested integrated-loudness and true-peak checks passed.",
          "That protects the source file but does not turn normalization into automatic mix approval. Listen to the new derivative, review any limiter or codec side effects, confirm the intended destination’s rules, and preserve the original until the responsible reviewer accepts the result.",
        ],
      },
      {
        heading: "5. Hand off a compact evidence record",
        paragraphs: [
          "A useful handoff names the exact reviewed file, configured black/freeze thresholds, loudness target and tolerance, returned findings, unresolved items, and the reviewer’s decision. If a finding is intentional, record why; if it is not, identify the sequence region and owner for the fix.",
          "Keep this technical record separate from a claim that the work is visually perfect or ready for every platform. The final decision still belongs to the editor, mixer, post supervisor, or delivery owner responsible for the destination.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does analyze_video_qc approve a delivery?",
        answer:
          "No. It reports black and frozen sections at selected thresholds in a local decoded-video scan. A reviewer must inspect the findings and apply the destination’s actual delivery requirements.",
      },
      {
        question: "Can I use one loudness target for every destination?",
        answer:
          "No. Select the target, tolerance, and peak ceiling supplied by the responsible platform, facility, or delivery owner. The tool measures the values you provide; it does not choose a universal standard.",
      },
      {
        question: "Will normalization overwrite my delivery file?",
        answer:
          "No. normalize_loudness_file requires a distinct new output path and refuses to overwrite either the input or an existing output file.",
      },
    ],
    resources: [
      { label: "Build a faster human visual-review pass", href: "/blog/premiere-pro-review-frames-and-scene-detection/" },
      { label: "Read the supported loudness and QC actions", href: "https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/docs/supported-actions.md" },
      { label: "Back up a project before a high-risk workflow", href: "/blog/premiere-pro-project-backup-checklist/" },
    ],
    relatedSlugs: ["premiere-pro-review-frames-and-scene-detection", "premiere-pro-project-backup-checklist"],
  },
  {
    slug: "premiere-pro-ai-workflow-checklist",
    seoTitle: "AI Workflow Checklist",
    workflowKit: "project-check",
    title: "Premiere Pro AI Workflow Checklist: Evaluate Automation Before It Touches a Project",
    description:
      "Use this practical checklist to evaluate an AI-assisted Adobe Premiere Pro workflow: define the boundary, verify the connection, preview the change, and inspect the result.",
    eyebrow: "Premiere Pro AI workflow checklist",
    publishedAt: "2026-08-22",
    modifiedAt: "2026-09-04",
    readingTime: "6 min read",
    keywords: ["Premiere Pro AI workflow checklist", "Premiere Pro automation checklist", "AI-assisted video editing workflow"],
    sections: [
      { heading: "Try this with disposable sample media", paragraphs: ["The downloadable workflow starter kit contains two synthetic video clips, a caption sample, and step-by-step evaluation prompts. Build a disposable sequence and compare the result with the checklist. The kit is not a recorded demonstration or a verified Premiere project; report any failed or unsupported check accurately."], bullets: ["Install the server and separate Premiere connector before trying the kit.", "Start with a read-only connection check and stop if it is not ready.", "Keep file exports and project changes behind their own explicit confirmation."] },
      {
        heading: "Use this checklist before an AI-assisted Premiere workflow",
        paragraphs: [
          "A useful Premiere Pro automation does not begin with a broad instruction like “edit this video.” It begins with a task an editor can describe, constrain, and check. This checklist is for assistant editors, technical editors, and post-production leads evaluating a workflow on a duplicate project or small test sequence before they rely on it in active work.",
          "It applies whether the assistant is using a native feature, a script, or a structured MCP connection. The goal is not to declare every automation safe. The goal is to make the next decision observable: what will change, what must not change, and how will the editor know the requested result happened?",
        ],
      },
      {
        heading: "1. Pick one repeated task with a visible definition of done",
        paragraphs: [
          "Choose work that happens often and has known inputs, constraints, and an expected outcome. Project inventory, bin organization, active-sequence inspection, proxy checks, marker preparation, and a standard delivery preflight are better first candidates than a complete creative rewrite.",
          "Write the definition of done before opening the assistant. Name the project or sequence, source clips, target tracks, time range, expected output, and any element that must remain unchanged. If the team cannot state those details, the job still needs editorial direction rather than automation.",
        ],
        bullets: [
          "Good boundary: “Inspect the active sequence and report its tracks and clips. Make no changes.”",
          "Good boundary: “Prepare a plan for these named clips on V2; preserve A1 and do not apply it yet.”",
          "Not yet bounded: “Make the pacing better” or “make this more engaging.”",
        ],
      },
      {
        heading: "2. Start with a no-change connection check",
        paragraphs: [
          "For a local MCP setup, install the compatible AI client, local server, and separate Premiere connector, then open Premiere with a project. Use the read-only connection check before asking for an edit: “Safely check my Premiere connection with verify_premiere_connection. Make no changes.”",
          "A successful check establishes the current connection path; it does not prove every command works on the active host. If it returns a diagnostic, resolve the connector, host, project, or capability condition before moving to an editing request.",
        ],
      },
      {
        heading: "3. Inspect the current state and capability boundary",
        paragraphs: [
          "Ask the assistant to inspect the active project or sequence before it proposes a change. Confirm that the names, tracks, timings, and source media it reports match what the editor sees. Then review the capability or diagnostic information for the specific operation you need.",
          "This is where structured tools are useful: the client can return data about the current request instead of inferring state from a workspace layout. But a tool catalog and a compatibility range are still not proof of a completed host operation. Treat the running Premiere session as the authority.",
        ],
      },
      {
        heading: "4. Ask for a bounded plan or preview before applying a change",
        paragraphs: [
          "For a meaningful edit, request a preview or plan that repeats the target, source, constraints, and expected result. Review it as you would a handoff from another editor. Make sure it does not substitute a different clip, track, sequence, or output preset just because a named target was unavailable.",
          "Approval should be specific to the plan you reviewed. Split sensitive work into smaller stages: inventory first, then a proposed assembly, then a deliberately approved supported change. Avoid turning a capability error into a retry loop for a mutating request.",
        ],
      },
      {
        heading: "5. Verify the result and keep the useful evidence",
        paragraphs: [
          "After an operation, re-inspect the relevant project or sequence state and review returned confirmation or diagnostics. An attempted command is not the same as a verified result. For deliveries, confirm the expected receipt or exported artifact; for timeline work, confirm the named tracks, clips, timing, and values that defined success.",
          "When the result matches the definition of done, save the bounded prompt, constraints, and verification step as a team recipe. When it does not, retain the diagnostic and stop before scaling the request. That creates a reviewable workflow rather than an opaque one-off automation.",
        ],
      },
      {
        heading: "6. Keep creative and project-risk decisions with the editor",
        paragraphs: [
          "Automation can handle structured, repeatable work. It does not replace editorial judgment about story, performance, pacing, music, or brand-sensitive choices. Use extra care with destructive batches, shared projects, incomplete media, and undocumented host behavior.",
          "Adobe’s evolving native AI features can be useful for their supported workflows. MCP for Adobe Premiere Pro is an independent, local-first option for teams that want compatible-client choice, structured tools, and explicit inspection and verification boundaries. Pick the path that fits the specific job, then use the same review discipline.",
        ],
      },
    ],
    faqs: [
      {
        question: "Should I test an AI Premiere workflow on a live project?",
        answer:
          "Start on a duplicate project or a small test sequence. Confirm the connection, named targets, requested operation, and returned result before using a larger or shared project.",
      },
      {
        question: "Does a successful connection check prove an edit will work?",
        answer:
          "No. It confirms the connection path. Inspect the current host state and capabilities, keep the first change bounded, and verify the result of the specific operation you need.",
      },
      {
        question: "What should I keep after a workflow passes?",
        answer:
          "Keep a short team recipe: the named inputs, no-change boundaries, the approved plan or prompt, and the exact verification step. This lets the next editor repeat the workflow without guessing.",
      },
    ],
    resources: [
      { label: "Install and run a safe connection check", href: "/#install" },
      { label: "Learn which Premiere tasks are good automation candidates", href: "/blog/premiere-pro-workflow-automation/" },
      { label: "See how MCP compares with Adobe Premiere’s AI Assistant", href: "/blog/adobe-premiere-ai-assistant-vs-mcp/" },
    ],
  },
  {
    slug: "what-is-a-premiere-pro-mcp-server",
    seoTitle: "What Is a Premiere MCP Server?",
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
          `The published v${product.version} package registers ${product.coreToolCount} core structured tools across timeline work, effects and Lumetri color, audio, captions, markers, keyframes, project organization, project-intake preview, media and proxy workflows, local media and interchange preflight analysis, diagnostics, export, review handoff, local editorial planning, and guarded After Effects MOGRT authoring, batch, library, render-queue, source-inspection, and Premiere-handoff workflows. The default capability profile exposes ${product.defaultProfileToolCount} of those tools. A compatible UXP host can add ${product.uxpAdditionalToolCount} capability-gated tools, bringing the connected surface to ${product.connectedUxpToolCount}. The development source separately registers ${sourceCatalog.coreTools} core tools and may include unreleased work.`,
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
    seoTitle: "AI Video Editing Workflows",
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
          `MCP for Adobe Premiere Pro is free, MIT-licensed, and designed for local-first use. Published v${product.version} registers ${product.coreToolCount} core tools for project inspection, project-intake preview, timeline editing, effects, color, audio, media management, local media and interchange preflight analysis, diagnostics, export, review handoff, review-only local editorial planning, and guarded After Effects MOGRT authoring, batch, library, render-queue, source-inspection, and Premiere-handoff workflows. The default profile exposes ${product.defaultProfileToolCount} tools; a compatible authenticated UXP host can add ${product.uxpAdditionalToolCount} capability-gated tools. These boundaries let the client report what is available rather than pretending that every supported feature is ready at every moment.`,
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
    seoTitle: "Premiere Workflow Automation",
    workflowKit: "product-spot",
    title: "Premiere Pro Workflow Automation: Repeat the Work, Not the Edit",
    description:
      "See which Adobe Premiere Pro tasks are good candidates for workflow automation, how to keep edits reviewable, and how to verify an AI-assisted result.",
    eyebrow: "Premiere Pro automation",
    publishedAt: "2026-08-19",
    modifiedAt: "2026-09-04",
    readingTime: "7 min read",
    keywords: ["Premiere Pro workflow automation", "Premiere Pro automation", "automate video editing workflow"],
    sections: [
      { heading: "Try this with disposable sample media", paragraphs: ["The downloadable workflow starter kit contains two synthetic video clips, a caption sample, and step-by-step evaluation prompts. Build a disposable sequence and compare the result with the checklist. The kit is not a recorded demonstration or a verified Premiere project; report any failed or unsupported check accurately."], bullets: ["Install the server and separate Premiere connector before trying the kit.", "Start with a read-only connection check and stop if it is not ready.", "Keep file exports and project changes behind their own explicit confirmation."] },
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
          `MCP for Adobe Premiere Pro combines that structure with a local-first bridge. Published v${product.version} registers ${product.coreToolCount} core tools, with capabilities, workflow packs, and authority reported separately from static tool support. That matters when different Premiere versions, permission settings, and connection states change what is safe to run. The correct path is to discover the available surface and verify the particular operation at call time.`,
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
    seoTitle: "Adobe AI Assistant vs. MCP",
    title: "Adobe Premiere Pro AI Assistant vs. MCP: How to Choose an AI Editing Workflow",
    description:
      "Compare Adobe’s public-beta in-app AI Assistant with a local MCP workflow: client choice, bounded project context, and reviewable Premiere automation.",
    eyebrow: "Choose the right workflow",
    publishedAt: "2026-08-22",
    modifiedAt: "2026-08-23",
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
        heading: "Choose Adobe’s assistant when the native beta workflow fits the job",
        paragraphs: [
          "Adobe documents its AI Assistant as a public beta for organizing media, preparing footage, and assembling an initial edit in Premiere. It is a sensible first place to look when a first-party in-app conversational experience and one of those documented workflows fit the task. Adobe also says the beta can change, so check the current documentation and test the exact workflow in the Premiere version your team uses.",
          "Adobe’s current FAQ says that bringing your own model, using reference documents or templated workflows, sharing conversations across a team, and exporting chat history are not available today. Those are product-scope facts, not reasons to dismiss the Assistant: they simply help a workflow owner choose the right control path and keep a human review boundary around a beta feature.",
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
          "The recommended MCP setup keeps Premiere, its connector, the server, and project media on the same computer. That does not change the privacy settings or data handling of the AI client a team chooses. Adobe likewise documents that some Assistant tools run locally while others can require media to be sent to the cloud. Review the exact client and workflow separately instead of treating either route as a universal privacy guarantee.",
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
          "It depends on the workflow. Adobe’s Assistant suits teams that prefer the documented first-party beta experience for its current organization, preparation, and assembly tasks. Premiere Pro MCP suits teams that need a compatible AI client, a local structured control path, and an explicit inspect-plan-preview-verify workflow.",
      },
      {
        question: "Can either assistant replace an editor’s review?",
        answer:
          "No. Context retrieval, plans, samples, and assistant actions are evidence tools, not editorial truth. An editor should review the target, the current host behavior, returned state, and any diagnostics before relying on a change.",
      },
    ],
    resources: [
      { label: "Read Adobe’s current AI Assistant overview", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html" },
      { label: "Read Adobe’s current AI Assistant FAQ", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html" },
      { label: "Run a safe Premiere connection check", href: "/#install" },
      { label: "Learn what an MCP server does in Premiere", href: "/blog/what-is-a-premiere-pro-mcp-server/" },
    ],
    relatedSlugs: ["premiere-pro-ai-workflow-checklist", "premiere-pro-project-intake-checklist"],
  },
  {
    slug: "claude-desktop-premiere-pro-mcp-setup",
    workflowKit: "project-check",
    title: "How to Set Up Claude with Premiere Pro MCP",
    seoTitle: "Claude Premiere Pro MCP Setup",
    description:
      "Set up Claude with Adobe Premiere Pro using the local MCP bundle and CEP connector, then verify the bridge before requesting any supported edit.",
    eyebrow: "Claude Premiere Pro setup",
    publishedAt: "2026-08-22",
    modifiedAt: "2026-09-10",
    readingTime: "9 min read",
    keywords: [
      "Claude Premiere Pro",
      "how to set up Claude Premiere Pro",
      "Claude Desktop Premiere Pro",
      "Claude Premiere Pro MCP setup",
      "Premiere Pro MCP Claude Desktop",
      "Premiere Pro safe connection check",
    ],
    sections: [
    {
        "heading": "Before you install",
        "paragraphs": [
            "Connect Claude Desktop to a running Premiere session with two separate downloads: the Claude bundle provides the MCP server, and the CEP connector provides the link to Premiere. Install both on the same Windows or macOS computer. This project is independent of Adobe and Anthropic.",
            `Published package: v${product.version}. The CEP route targets Premiere Pro ${product.premiereCompatibility}; individual operations remain host-dependent. UXP support is a separate capability-gated path and does not replace the first-install CEP route.`
        ],
        "bullets": [
            "Use the desktop Claude app for the local bundle route. A connection configured in the browser is a different setup.",
            "Choose a disposable project or a copy, open an active sequence, and keep the original edit recoverable.",
            "Use the matching downloads below. The npm package published by this repository is premiere-pro-mcp; similarly named packages belong to other projects."
        ],
        "links": [
            {
                "label": "Download the Claude Desktop bundle",
                "href": product.downloads.claudeBundle
            },
            {
                "label": "Download the Premiere CEP connector",
                "href": product.downloads.signedCepConnector
            },
            {
                "label": "Read the matching release notes",
                "href": product.downloads.releaseNotes
            }
        ]
    },
    {
        "heading": "Install the Claude bundle and Premiere connector",
        "paragraphs": [
            "The bundle includes its own local server runtime. The recommended bundle route does not require a separate Node.js installation. A managed Claude workspace may restrict custom extensions; follow the workspace administrator's policy."
        ],
        "steps": [
            "In Claude Desktop, open Settings > Extensions > Advanced settings. Choose Install Extension and select the downloaded .mcpb file. Complete the displayed configuration.",
            "Install MCPBridgeCEP.zxp using a ZXP installer you trust. If you do not have an installer, use the npm alternative in the next section.",
            "Fully quit and reopen Claude Desktop and Premiere Pro. Open your disposable project and select a sequence.",
            "In Premiere, open Window > Extensions > MCP for Adobe Premiere Pro. Older connector builds may use the label MCP Bridge. Keep the panel open.",
            "Start a new Claude conversation and run the connection-check prompt below before requesting an edit."
        ],
        "links": [
            {
                "label": "Claude's custom-extension installation instructions",
                "href": "https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop"
            }
        ]
    },
    {
        "heading": "Alternative: install the connector with npm",
        "paragraphs": [
            "Use this alternative if you need the connector installer or prefer to configure a local server manually. It requires Node.js 20.19 or newer. Run these commands in a terminal on the computer running Premiere. The connector installer enables the Adobe CEP debug setting required by this installation route.",
            "If you already installed the Claude bundle, do not add a second Claude MCP entry for the same server. Use the commands to install and diagnose the connector, then continue with the bundle."
        ],
        "codeBlocks": [
            {
                "label": "Install the published server and CEP connector",
                "code": connectorSetup
            }
        ],
        "links": [
            {
                "label": "Manual client configuration and compatibility",
                "href": "/docs/"
            }
        ]
    },
    {
        "heading": "Run the read-only connection check",
        "paragraphs": [
            "Send this prompt in Claude. A tool appearing in the client proves discovery, not that the Premiere panel is connected. Read the tool result and stop if it reports a missing connector, project, sequence, or permission."
        ],
        "codeBlocks": [
            {
                "label": "First prompt: check the local Premiere connection",
                "code": "Safely check my Premiere connection with verify_premiere_connection. Make no changes."
            }
        ],
        "bullets": [
            "Installed: the server and connector are present.",
            "Configured: the client knows how to start the local server.",
            "Connected: the connector answers for the intended Premiere session.",
            "Verified for this task: inspect the particular project, sequence, and capability before relying on a later operation."
        ]
    },
    {
        "heading": "Walk through your first project inspection",
        "paragraphs": [
            "After the connection check succeeds, use this small inspection exercise. It asks for observable project state and leaves editing decisions for a later request. The downloadable starter kit contains synthetic clips for a disposable project; it is an evaluation sample, not a recorded host demonstration."
        ],
        "codeBlocks": [
            {
                "label": "Second prompt: inspect the active sequence",
                "code": "Inspect my open Premiere project and active sequence. Report the sequence name, frame rate, duration, video and audio track counts, and any unavailable fields. Make no changes. Do not export files or upload media."
            }
        ],
        "steps": [
            "Compare the reported sequence name and frame rate with the sequence open in Premiere.",
            "Compare the returned duration and track counts with the timeline. An unavailable field is not a successful check.",
            "If an identity or value disagrees, stop and resolve the connection or target before asking for a change.",
            "For a later edit, name the target, ask for a preview where supported, approve that exact change, and inspect the result."
        ],
        "links": [
            {
                "label": "Download the disposable workflow starter kit",
                "href": "/workflows/#project-check"
            },
            {
                "label": "Use the Project Intake checklist",
                "href": "/project-intake/"
            },
            {
                "label": "Choose a collaboration workflow",
                "href": "/premiere-pro-collaboration-workflow/"
            }
        ]
    },
    {
        "heading": "Fix the failure you actually see",
        "paragraphs": [
            "Use the failing layer to choose the next step. Avoid repeating an edit request while the connection remains unresolved."
        ],
        "bullets": [
            "Bundle installed, but tools missing: restart Claude Desktop, check Extensions for the enabled bundle, and start a new conversation. Check managed-workspace restrictions if custom extensions are unavailable.",
            "No Premiere panel in the Extensions menu: confirm the separate CEP connector was installed for the current user, then fully restart Premiere. Installing the Claude bundle alone does not install this connector.",
            "Connection timeout: keep the panel open, confirm Premiere is responsive, and check that the server and panel use the same bridge directory. Do not substitute a public hosted endpoint for a local bridge.",
            "No active project or sequence: open a project and select the intended sequence, then repeat only the read-only check.",
            "Unsupported tool or host capability: inspect the available capabilities and use a supported route. A larger catalog is not proof that a host supports an operation.",
            "Need help: include OS, Premiere version, package version, and a redacted diagnostic. Remove project names, media paths, prompts, footage, tokens, and personal data before posting."
        ],
        "links": [
            {
                "label": "Open the troubleshooting reference",
                "href": "/docs/troubleshooting/"
            },
            {
                "label": "Report an installation problem",
                "href": "https://github.com/leancoderkavy/premiere-pro-mcp/issues"
            }
        ]
    },
    {
        "heading": "Understand what stays local",
        "paragraphs": [
            "The recommended server, connector, and Premiere media path run on your computer. Claude's own conversation and tool-data policies still apply; local execution does not mean that every interaction with the assistant stays on-device. Review the client's privacy controls before sharing project context.",
            "Keep the local installation distinct from the operator-managed hosted MCP service. The public website does not pair a cloud server with a visitor's Premiere session."
        ],
        "links": [
            {
                "label": "Privacy and telemetry details",
                "href": "/privacy/"
            }
        ]
    }
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
    relatedSlugs: ["how-to-set-up-premiere-pro-mcp", "codex-premiere-pro-mcp-setup"],
  },
  {
    slug: "how-to-set-up-premiere-pro-mcp",
    title: "How to Set Up Premiere Pro MCP Safely",
    seoTitle: "How to Set Up Premiere Pro MCP",
    description:
      "Set up Premiere Pro MCP: install the local server and connector, configure a compatible AI client, and verify the live bridge before your first edit.",
    eyebrow: "Premiere Pro MCP setup",
    publishedAt: "2026-09-08",
    modifiedAt: "2026-09-10",
    readingTime: "8 min read",
    keywords: [
      "how to setup Premiere Pro MCP",
      "how to set up Premiere Pro MCP",
      "Premiere Pro MCP setup",
      "Premiere Pro AI MCP server",
    ],
    sections: [
      {
        heading: "What you need before you set up Premiere Pro MCP",
        paragraphs: [
          "Premiere Pro MCP connects a compatible AI client to a running Adobe Premiere Pro session through a local server and a separate Premiere connector. The recommended arrangement keeps the AI client, MCP server, connector, Premiere, and project media on the same computer. It is not a hosted editing service and it does not make a cloud deployment control the Premiere project open on your workstation.",
          `For the supported local path, use Windows or macOS, Premiere Pro ${product.premiereCompatibility}, and Node.js ${product.nodeVersion}+ when your chosen client does not use the released Claude Desktop bundle. Keep a duplicate project or small test sequence available for the first supported change. Compatibility and a successful installation do not prove every host operation on every machine.`,
        ],
      },
      {
        heading: "1. Install the local server and Premiere connector",
        paragraphs: [
          "For a compatible client without its own bundle, use the versioned npm commands below. They select this project's package instead of relying on a global executable shared with another Premiere MCP package. The installer puts the per-user CEP connector in Premiere's extensions location and enables the required local debug setting. If you use Claude Desktop, the release bundle supplies the server, but the signed Premiere connector is still a separate install.",
          "Restart Premiere after the connector is installed. With a project open, use Window > Extensions > MCP for Adobe Premiere Pro to open the connector. Do not move on to an edit request until the connector is available in the live host.",
        ],
        codeBlocks: [{ label: "Install and diagnose the versioned connector", code: connectorSetup }],
      },
      {
        heading: "2. Configure one compatible AI client",
        paragraphs: [
          "Your AI client needs a local MCP-server entry for this package. The JSON below works as an entry for clients using mcpServers; Codex uses its own configuration format. Merge the entry into existing settings and keep other servers. Follow the specific setup guide for your client.",
          "Choose one client for the first check. Claude Desktop has a release bundle; Codex has a repository plugin; other clients may use the npm-based local configuration. Keep the client on the same machine as Premiere for this local setup. A public operator-managed HTTP endpoint is not a desktop relay for your local Premiere project.",
        ],
        codeBlocks: [{ label: "Versioned local entry for clients using mcpServers", code: localMcpConfig }],
        links: [{ label: "Cursor configuration and connection check", href: "/blog/cursor-premiere-pro-mcp-setup/" }, { label: "Codex configuration", href: "/blog/codex-premiere-pro-mcp-setup/" }],
      },
      {
        heading: "3. Verify the connection before asking for an edit",
        paragraphs: [
          "Fully restart the AI client and Premiere, open a project, and select an active sequence. Then send this exact first request: Safely check my Premiere connection with verify_premiere_connection. Make no changes. It is deliberately read-only, so it separates an installation or bridge problem from an editing problem without requesting a project mutation.",
          "If the check returns a diagnostic, resolve the reported connection, host, project, sequence, or capability condition first. If it succeeds, inspect the active project or sequence, then ask for a small bounded plan or preview before applying a supported operation. A tool being listed or called is not proof that a Premiere change completed.",
        ],
        bullets: [
          "Start with inspection or a plan, not a large timeline rewrite.",
          "Name the target sequence, tracks, source clips, and no-change boundaries for a supported edit.",
          "Review returned state or diagnostics after every meaningful operation.",
        ],
      },
      {
        heading: "Troubleshoot the setup without sharing media or secrets",
        paragraphs: [
          "When the read-only check fails, reopen both applications, confirm the correct Premiere project and active sequence are open, and confirm the connector appears under Premiere's Extensions menu. Share the returned diagnostic with support instead of screenshots of sensitive footage, project names, media paths, prompts, or credentials.",
          "The local-first Premiere path does not change how your chosen AI client handles conversations or data. Review that client's privacy controls independently. Do not expose the MCP HTTP transport to the public internet without the authentication and edge controls documented for an operator-managed deployment.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do I need to know how to code to set up Premiere Pro MCP?",
        answer:
          "No for the Claude Desktop bundle path, although you still install the separate Premiere connector. The npm path is an advanced setup that needs Node.js and an MCP-server entry in your chosen client.",
      },
      {
        question: "Can I set up Premiere Pro MCP without changing a project?",
        answer:
          "Yes. Use verify_premiere_connection first, then inspect the project or active sequence. Ask for a preview or plan before approving a supported change.",
      },
      {
        question: "Does the setup upload my Premiere footage?",
        answer:
          "The recommended MCP server and connector setup is local. Your selected AI client's data handling and privacy settings remain separate and should be reviewed before you share project context.",
      },
    ],
    resources: [
      { label: "Read the technical setup reference", href: "/docs/" },
      { label: "Set up Claude with Premiere Pro MCP", href: "/blog/claude-desktop-premiere-pro-mcp-setup/" },
      { label: "Set up Codex with Premiere Pro MCP", href: "/blog/codex-premiere-pro-mcp-setup/" },
      { label: "Read the full project README", href: "https://github.com/leancoderkavy/premiere-pro-mcp#quick-start" },
    ],
    relatedSlugs: [
      "set-up-ai-in-premiere-pro",
      "claude-desktop-premiere-pro-mcp-setup",
      "codex-premiere-pro-mcp-setup",
    ],
  },
  {
    slug: "set-up-ai-in-premiere-pro",
    title: "How to Set Up AI in Premiere Pro: A Practical Guide",
    seoTitle: "Set Up AI in Premiere Pro",
    description:
      "Set up AI in Premiere Pro with native Adobe features or a compatible MCP assistant, then use a reviewable workflow that keeps creative control.",
    eyebrow: "AI Premiere Pro setup",
    publishedAt: "2026-09-08",
    modifiedAt: "2026-09-08",
    readingTime: "8 min read",
    keywords: [
      "AI Premiere Pro",
      "Premiere Pro AI",
      "how to setup Premiere Pro AI",
      "how to set up AI in Premiere Pro",
    ],
    sections: [
      {
        heading: "AI in Premiere Pro starts with the workflow, not a prompt",
        paragraphs: [
          "People searching for AI Premiere Pro tools are often looking for different things: Adobe's native AI features, a conversational assistant inside Premiere, or an external AI client that can help with a local project. Decide which job you want to improve before installing anything. Generative media, transcript-based editing, media organization, and structured workflow automation are different control paths with different privacy, availability, and review requirements.",
          "A useful AI setup protects the existing edit. Start with a clear input, a named target, and a way to inspect the outcome. Avoid treating a fluent response, a listed feature, or an attempted tool call as evidence that a timeline is ready for delivery.",
        ],
      },
      {
        heading: "Set up Adobe's native AI features when they fit the task",
        paragraphs: [
          "Premiere's native AI capabilities and beta features change over time, so begin with Adobe's current documentation for the exact Premiere version and feature you use. Adobe's AI Assistant is a first-party, in-app beta for documented organization, footage preparation, and initial-assembly tasks. Generative and assistive tools can have their own availability, model, credit, or cloud-processing conditions.",
          "Use a duplicate project or test sequence for a new native AI workflow. Confirm what media, frames, prompts, or metadata the feature can send or retain, then inspect the result in the active sequence. Native AI can be the right choice when its documented workflow directly matches your edit; it does not need to be replaced by an external assistant.",
        ],
      },
      {
        heading: "Set up a compatible AI assistant for structured Premiere work",
        paragraphs: [
          "An MCP-based setup is a separate option for editors who want a compatible AI client to use named Premiere tools through a local connection. Install the Premiere MCP server and CEP connector, configure one client, restart the client and Premiere, then run the read-only connection check. The recommended path keeps Premiere, its connector, the server, and project media on the local computer.",
          "Use the assistant for bounded work that can be checked: inspect a sequence, inventory a project, propose a B-roll assembly, prepare a marker plan, or preflight a delivery. Use names, tracks, time ranges, output expectations, and no-change boundaries. Smaller steps make it easier to identify whether a problem comes from the setup, host capabilities, or the request itself.",
        ],
      },
      {
        heading: "Use the inspect, plan, preview, and verify loop",
        paragraphs: [
          "The first AI request should be read-only: Safely check my Premiere connection with verify_premiere_connection. Make no changes. Once it succeeds, ask to inspect the active sequence. For a possible edit, request a plan or preview, confirm the exact target, and then inspect returned state or diagnostics after the supported operation.",
          "This approach preserves the editor's role in story, performance, timing, and creative taste. AI can make repeatable setup and verification work more legible, but it does not provide a universal shortcut to editorial judgment.",
        ],
        bullets: [
          "Use Adobe's documented feature when the native AI workflow fits your task.",
          "Use a compatible MCP client when you need a structured local control path into Premiere.",
          "Keep client privacy settings and Premiere's local connection as separate decisions.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does Premiere Pro already have AI features?",
        answer:
          "Yes. Adobe offers native AI-assisted features and beta workflows whose scope changes by release. Check Adobe's current documentation for the exact feature and conditions before relying on it in a project.",
      },
      {
        question: "Can I use ChatGPT, Claude, or Codex with Premiere Pro?",
        answer:
          "They need an appropriate connection path. Claude Desktop has a released bundle, Codex has a repository plugin, and ChatGPT's custom MCP path is remote rather than direct local stdio. Read the client-specific guide before connecting a live project.",
      },
      {
        question: "Is an AI-assisted Premiere result automatically safe to use?",
        answer:
          "No. Verify the specific host behavior and returned result. Use a duplicate project or test sequence for a new workflow and keep meaningful changes reviewable.",
      },
    ],
    resources: [
      { label: "Read Adobe's current Premiere AI Assistant overview", href: "https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html" },
      { label: "Compare Adobe AI Assistant with MCP", href: "/blog/adobe-premiere-ai-assistant-vs-mcp/" },
      { label: "Learn how to set up Premiere Pro MCP", href: "/blog/how-to-set-up-premiere-pro-mcp/" },
      { label: "Read the Premiere Pro AI workflow checklist", href: "/blog/premiere-pro-ai-workflow-checklist/" },
    ],
    relatedSlugs: [
      "ai-video-editing-with-premiere-pro",
      "adobe-premiere-ai-assistant-vs-mcp",
      "how-to-set-up-premiere-pro-mcp",
    ],
  },
  {
    slug: "chatgpt-premiere-pro-mcp",
    title: "ChatGPT + Premiere Pro: Connect MCP the Safe Way",
    seoTitle: "ChatGPT Premiere Pro MCP Guide",
    description:
      "Learn what ChatGPT can do with Premiere Pro, why it cannot connect directly to a local stdio MCP server, and how to evaluate a secure remote MCP setup.",
    eyebrow: "ChatGPT Premiere Pro guide",
    publishedAt: "2026-09-08",
    modifiedAt: "2026-09-08",
    readingTime: "7 min read",
    keywords: [
      "ChatGPT Premiere Pro",
      "ChatGPT Premiere Pro MCP",
      "connect ChatGPT to Premiere Pro",
      "Premiere Pro ChatGPT setup",
    ],
    sections: [
      {
        heading: "What ChatGPT can and cannot do with Premiere Pro",
        paragraphs: [
          "ChatGPT can help you reason about an edit, draft a workflow, or work with tools exposed through a suitable MCP connection. It does not automatically see an open Premiere project, control the Premiere interface, or receive a local project's media just because you mention the project in a chat. Live Premiere access requires an explicit tool connection and a running bridge that exposes only the actions you intend to allow.",
          "That distinction matters for both setup and security. Use ChatGPT for planning without a live connection when you only need ideas or a review checklist. Use an MCP connection only after you understand what server, tools, credentials, and confirmation boundaries are involved.",
        ],
      },
      {
        heading: "ChatGPT does not connect directly to a local stdio server",
        paragraphs: [
          "ChatGPT's custom MCP-app route uses remote MCP servers; it does not directly attach to a local stdio server running beside Premiere. OpenAI documents Secure MCP Tunnel for a server on a private network, on-premises, or a developer machine. Availability, workspace permissions, and write access vary by ChatGPT plan and are currently evolving, so check the current official documentation before configuring a connector.",
          "Do not reinterpret a public HTTP endpoint as a way to control the Premiere project open on your computer. The operator-managed Premiere Pro MCP instance is not a desktop relay for public users. A remote design needs explicit pairing or a secure tunnel to the machine that runs the Premiere bridge, not an exposed token pasted into a chat or a URL.",
        ],
      },
      {
        heading: "Evaluate a remote MCP design before you connect it",
        paragraphs: [
          "Start with a narrow read-only tool surface. Confirm the organization and administrator controls required for your ChatGPT workspace, the endpoint and authentication model, the tool list ChatGPT scans, and the way each write or modify action asks for confirmation. Only connect a server you trust and have reviewed for prompt-injection and credential risks.",
          "For Premiere Pro MCP, the recommended initial setup remains local stdio in an MCP-compatible desktop client. If your organization is evaluating ChatGPT's remote connector path, use a test project, enforce authentication and edge controls, and do not expose raw project paths, media, prompts, or tokens just to make the integration convenient.",
        ],
      },
      {
        heading: "Keep the first live Premiere task read-only",
        paragraphs: [
          "Once a secure connection is genuinely in place, start by checking the bridge and reading current capabilities. Ask for a Premiere connection check with no changes, then inspect the active project or sequence. Do not start with timeline deletion, batch media changes, or an export you cannot independently review.",
          "A connected assistant can make a workflow easier to direct, but it cannot replace a host-specific verification step. Treat returned state or diagnostics as the evidence to review before you rely on an operation.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can ChatGPT directly control Premiere Pro on my computer?",
        answer:
          "Not through a direct local stdio connection. A live setup needs an explicit remote MCP connection path, such as the secure private-server approach described in current OpenAI documentation, and a running local Premiere bridge.",
      },
      {
        question: "Can I use ChatGPT to plan a Premiere edit without connecting a tool?",
        answer:
          "Yes. You can discuss a workflow, prompt, or review checklist without granting access to a live project. ChatGPT cannot inspect the actual project state unless you explicitly provide context or connect an approved tool.",
      },
      {
        question: "Should I expose Premiere Pro MCP's HTTP server to the internet?",
        answer:
          "No. The HTTP transport requires authentication and documented edge protections. A secure tunnel or organization-approved remote setup should be designed and reviewed before it is used with a live Premiere project.",
      },
    ],
    resources: [
      { label: "Read OpenAI's current ChatGPT developer-mode and MCP guidance", href: "https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta" },
      { label: "Read the Premiere Pro MCP HTTP security boundary", href: "https://github.com/leancoderkavy/premiere-pro-mcp#security" },
      { label: "Set up Premiere Pro MCP locally first", href: "/blog/how-to-set-up-premiere-pro-mcp/" },
      { label: "Set up Codex with Premiere Pro MCP", href: "/blog/codex-premiere-pro-mcp-setup/" },
    ],
    relatedSlugs: [
      "how-to-set-up-premiere-pro-mcp",
      "codex-premiere-pro-mcp-setup",
      "set-up-ai-in-premiere-pro",
    ],
  },
  {
    slug: "codex-premiere-pro-mcp-setup",
    title: "How to Set Up Codex with Premiere Pro MCP",
    seoTitle: "Codex Premiere Pro MCP Setup",
    description:
      "Connect Codex to Adobe Premiere Pro with a local MCP command or the repository plugin, install the CEP bridge, and verify the connection before editing.",
    eyebrow: "Codex Premiere Pro setup",
    publishedAt: "2026-09-08",
    modifiedAt: "2026-09-10",
    readingTime: "7 min read",
    keywords: [
      "Codex Premiere Pro",
      "Codex Premiere Pro MCP",
      "how to set up Codex with Premiere Pro",
      "Premiere Pro MCP Codex plugin",
    ],
    sections: [
{
    "heading": "Configure Codex with the local server",
    "paragraphs": [
        "Use the same computer for Codex, the server, the CEP connector, and Premiere. This direct MCP configuration is an alternative to the repository plugin; choose one route so the server is not registered twice. It requires Node.js 20.19 or newer."
    ],
    "codeBlocks": [
        {
            "label": "Install, diagnose, and register the local server",
            "code": `${connectorSetup}\ncodex mcp add premiere-pro-leancoderkavy -- npx --yes premiere-pro-mcp@${product.version}\ncodex mcp list`
        }
    ],
    "steps": [
        "Restart Premiere and open Window > Extensions > MCP for Adobe Premiere Pro.",
        "Open a disposable project and active sequence. Start a new Codex session.",
        "Ask Codex to run verify_premiere_connection without making changes. Inspect the returned diagnostic before proceeding."
    ],
    "links": [
        {
            "label": "Official Codex MCP configuration",
            "href": "https://developers.openai.com/codex/mcp/"
        },
        {
            "label": "Connector troubleshooting",
            "href": "/docs/troubleshooting/"
        }
    ]
},
      {
        heading: "What the Codex plugin connects",
        paragraphs: [
          "Codex does not control Adobe Premiere Pro by default. This repository includes an installable Codex plugin that bundles the local Premiere Pro MCP server configuration with a safety-oriented editing skill. The plugin still needs the separate CEP connector because that connector carries supported requests between the local server and the open Premiere session.",
          "Use this setup from a clone of the repository, on the same computer as Codex and Premiere. The first goal is a live, read-only connection check, not a complex edit. Have a duplicate project or a small test sequence ready before you approve any supported mutation.",
        ],
      },
      {
        heading: "Install the Codex plugin and local Premiere connector",
        paragraphs: [
          "From a local clone of the Premiere Pro MCP repository, add the repository as a Codex plugin marketplace, then install the Premiere plugin: codex plugin marketplace add . followed by codex plugin add premiere-pro@premiere-pro-mcp. This registers the packaged MCP configuration for Codex; do not copy a configuration from an unrelated Premiere bridge.",
          `Next, install the local CEP connector with the versioned package command from the current project README. The current release command is npx -y premiere-pro-mcp@${product.version} --install-cep. The CEP installer is separate from the Codex plugin and is required for the local MCP server to communicate with the running Premiere host.`,
        ],
      },
      {
        heading: "Restart both applications and open the bridge",
        paragraphs: [
          "Restart Premiere Pro, open the project you intend to inspect, and open Window > Extensions > MCP for Adobe Premiere Pro. Then begin a new Codex session so it picks up the installed plugin configuration. Keep the initial connection local; the public operator-managed HTTP service is not a general relay to the project open on your workstation.",
          "The default CEP route targets Premiere Pro 2020–2026 on Windows and macOS. UXP functionality is capability-gated on compatible hosts and does not replace the CEP setup needed for this first connection.",
        ],
      },
      {
        heading: "Use a safe first Codex request",
        paragraphs: [
          "First ask Codex to inspect the available capabilities, then ask: Safely check my Premiere connection with verify_premiere_connection. Make no changes. When it succeeds, inspect the active project or sequence before proposing an edit. If it returns a diagnostic, resolve that specific condition instead of retrying a mutating request.",
          "For a later supported change, name the sequence, target tracks, source clips, expected output, and no-change boundaries. Ask for a plan or preview where available, approve only the exact target you reviewed, and inspect returned state or diagnostics afterward. The plugin provides an integration path; it does not turn every operation into a host-proven result.",
        ],
        bullets: [
          "Run the plugin and CEP connector on the same machine as Premiere.",
          "Begin a new Codex session after installing the plugin.",
          "Check capabilities and connection state before an edit request.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can Codex edit Premiere Pro without a plugin or bridge?",
        answer:
          "Codex needs a configured local MCP server and the separate Premiere CEP connector. You can configure the server directly or use the repository plugin.",
      },
      {
        question: "Does the Codex plugin prove an edit worked?",
        answer:
          "No. It makes the local MCP connection available. Verify the specific Premiere operation with returned state, diagnostics, and your own project review.",
      },
      {
        question: "Can I use the Codex plugin with a production project?",
        answer:
          "Use a duplicate project or test sequence for a new workflow. Start read-only, review plans, and keep destructive or version-sensitive operations bounded and verifiable.",
      },
    ],
    resources: [
      { label: "Read the Codex plugin instructions in the project README", href: "https://github.com/leancoderkavy/premiere-pro-mcp#codex-plugin" },
      { label: "Learn how to set up Premiere Pro MCP", href: "/blog/how-to-set-up-premiere-pro-mcp/" },
      { label: "Set up Claude with Premiere Pro MCP", href: "/blog/claude-desktop-premiere-pro-mcp-setup/" },
      { label: "Read the technical documentation", href: "/docs/" },
    ],
    relatedSlugs: [
      "how-to-set-up-premiere-pro-mcp",
      "chatgpt-premiere-pro-mcp",
      "claude-desktop-premiere-pro-mcp-setup",
    ],
  },
]

export const articleBySlug = new Map(articles.map((article) => [article.slug, article]))
