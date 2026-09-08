# Premiere Pro MCP: 90-day marketing and discovery plan

Prepared September 4, 2026. Planning document; campaigns and product changes have not been executed.

**Recommendation:** Make one Premiere workflow easy to demonstrate, reproduce, and share. Use that workflow to drive creator coverage and community adoption, then turn the resulting demonstrations, recipes, and evidence into durable search content.

**Positioning:** “Your AI assistant, connected to your Premiere workflow.”

**Supporting copy:** “Inspect your project, preview supported changes, and automate repeatable editing tasks with a free, open-source Premiere connector.”

Virality is an uncertain outcome. This plan creates repeated opportunities for useful demonstrations to spread and converts that attention into successful use. Its primary objective is adoption; GitHub stars are a secondary distribution signal.

## 1. Starting point and immediate priorities

Research combined live public pages, GitHub and npm APIs, current remote source, Ahrefs, and official platform guidance. Source snapshot: `c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf`. The working checkout is older and contains existing edits; those were preserved.

| Signal | Observed September 4 | Interpretation |
| --- | --- | --- |
| GitHub audience | 234 stars; 39 forks | There is an audience to build on. Neither establishes active usage. |
| GitHub traffic, August 21–September 3 | 3,851 views; 1,552 unique visitors | Discovery baseline for a 14-day window. |
| GitHub cloning, same window | 12,728 clones; 1,178 unique cloners | Distribution signal that can include automated activity. Do not infer conversion from the visitor/cloner ratio. |
| npm downloads, August 5–September 3 | 6,769 | Downloads include repeat installs and automation; they are not unique editors. |
| Latest GitHub release | v1.14.8 | Release publication is separate from current-main capability and live-host evidence. |
| Live website | All 18 sitemap URLs returned HTTP 200, matched their declared canonical, and had no `noindex` in returned HTML | Good basic accessibility. Search Console indexation, response-header directives, field performance, and complete rendered-page validation remain unmeasured. |
| Existing content | Ten guides, Project Intake page, workflow-fit guide, facts page, docs, robots, sitemap, and two AI reference files | Improve and distribute these assets before commissioning overlapping articles. |
| Ahrefs domain estimate | Zero organic keywords and zero estimated organic traffic | Ahrefs has no estimated visibility for this domain in this query; this does not establish zero real search traffic. Keyword-volume requests failed twice. |
| Official MCP Registry | Namespace search returned no servers | Distribution opportunity; recheck exact identity and current registry status when preparing publication. |
| Activation and retention | No current production baseline established in this research | Measure directly before claiming installs, time saved, or weekly active editors. |

Sources: [repository](https://github.com/leancoderkavy/premiere-pro-mcp), authenticated GitHub traffic API responses for this repository, [dated npm count](https://api.npmjs.org/downloads/point/2026-08-05:2026-09-03/premiere-pro-mcp), [release](https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.14.8), [sitemap](https://premiere-pro-mcp.com/sitemap.xml), [registry query](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.leancoderkavy/premiere-pro). Ahrefs query: `site-explorer-metrics`, domain mode, September 4, 2026.

**Fix the public identity and claim drift first.** The live facts page and `llms.txt` say 332 core tools, the GitHub description says 344, and current-main product metadata says 349. Existing product-marketing context v9 retains older counts. These surfaces mix release and source information without a clear common reference. Generate release facts from the actual released artifact, label unreleased main separately, and reuse the resulting data across HTML, metadata, README, directory entries, and AI reference files. Lead promotional copy with outcomes so every catalog change does not require a new campaign. [Live facts](https://premiere-pro-mcp.com/facts/), [AI reference](https://premiere-pro-mcp.com/llms.txt), [source snapshot](https://github.com/leancoderkavy/premiere-pro-mcp/blob/c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf/landing/lib/product.ts).

## 2. Audience and competitive position

Keep the existing primary audience: technical editors, assistant editors, and workflow leads in small post-production teams. They have repeatable work and can validate a local install. Use independent Premiere educators and developer-creators as the distribution audience: their demonstrations can reach many of those editors.

| Audience | Immediate job | Message | First conversion |
| --- | --- | --- | --- |
| Independent editor or assistant editor | Inspect a sequence, organize material, prepare a handoff | “Give your assistant a defined Premiere task and inspect the result.” | Complete a sample workflow |
| Post lead at a small team | Make recurring preparation and delivery steps repeatable | “Turn your team’s workflow into a reusable, reviewable recipe.” | Test one recipe on two editor systems |
| Premiere educator or creator | Show viewers a useful new technique | “Here is the project, prompt, recording, and setup guide for a demo you can reproduce.” | Independently reproduce and explain it |
| MCP developer | Integrate an assistant with a real creative application | “An open Premiere integration with capability discovery and guarded workflow routes.” | Install, inspect capabilities, contribute a recipe or fix |

Adobe’s native AI Assistant already addresses natural-language organization, preparation, and initial assembly. Its current FAQ says bringing your own model is unsupported. FireCut and AutoCut market concrete outcomes including silence removal, captions, and social editing. These findings favor a position around **assistant choice, open workflow recipes, and observable results inside an existing Premiere project**. Avoid claiming unique ownership of AI editing, captions, or silence removal. This is positioning judgment, not a hands-on performance comparison. [Adobe overview](https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/overview.html), [Adobe FAQ](https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html), [FireCut](https://firecut.ai/), [AutoCut](https://www.autocut.com/en/).

Use one canonical name, **MCP for Adobe Premiere Pro**, with **Premiere Pro MCP** as its shorthand. Put the project owner, repository, npm package, license, compatible client routes, and Adobe independence statement on the facts and install pages. “Free” describes this project; Premiere, After Effects where required, and the selected AI client can have their own costs.

## 3. Capabilities to turn into campaigns

These are source-backed campaign candidates. A tool definition or passing contract test does not establish a successful edit in a licensed Premiere host. Qualify demonstrations against the exact released package, OS, Premiere build, client, and connector used.

| Priority | Campaign and hook | Existing foundation | Work needed before promotion |
| --- | --- | --- | --- |
| P0 | **One-prompt project check:** “What needs attention before I hand this sequence over?” | `preview_project_intake`, `inspect_sequence_review_report`, connection verification | Record a real project inspection; show exact findings, their scope, and the unchanged timeline. Fastest candidate for first-use success. |
| P0 | **Prompt to product spot:** “I asked my assistant to assemble these product shots in Premiere.” | Product/brand-spot preview and guarded application routes using existing project items | Prove the complete preview/apply path on disposable media, inspect playback, and export the result. No claim of generating the footage or autonomous creative judgment. Strongest visual launch candidate. |
| P1 | **Interview selects:** “Find the passages for this story before opening every clip.” | Captured transcript evidence, context packs, editorial plans | Supply actual transcript evidence; demonstrate citations and time ranges. The planning tools do not themselves transcribe media or execute a rough cut. |
| P1 | **Review-frame pack:** “Turn timeline markers into a visual review sheet.” | Marker and clip review-frame export | Prove exported frame files and their correspondence to the sequence; provide a reusable review template. File output does not establish editorial approval. |
| P1 | **Delivery preflight:** “Check this export before sending it.” | Local loudness, stream, black/freeze, and conformance analysis | Publish a fixture with known defects and show exact detections and limits. Report actual output-file findings, not blanket broadcast compliance. |
| P2 | **Branded graphics batch:** “Create a repeatable set of lower thirds from a CSV.” | After Effects MOGRT recipe and batch tools | Validate required After Effects setup, exact export, Premiere import, and final appearance. More setup friction makes this a follow-on campaign. |
| P2 | **Multi-format delivery plan:** “Plan this edit for landscape, square, and portrait.” | `platform_cutdown` planning and separate capability-gated host operations | Market planning accurately today. Promote finished cutdowns only after clone, reframing, captions if used, and export are individually demonstrated. |
| P2 | **Silence review:** “Show the pauses before changing the cut.” | FFmpeg silence detection, marker planning, guarded editing routes | Show review candidates first; validate actual removal, mapping, and playback independently. Avoid a generic “better than AutoCut” claim. |

Repository evidence: [supported actions](https://github.com/leancoderkavy/premiere-pro-mcp/blob/c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf/docs/supported-actions.md), [editorial boundaries](https://github.com/leancoderkavy/premiere-pro-mcp/blob/c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf/docs/ai-editorial-workflows.md), [host validation](https://github.com/leancoderkavy/premiere-pro-mcp/blob/c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf/docs/editorial-workflow-host-validation.md).

Start with the project check and product spot. If the product-spot workflow fails the real-host test, launch the proven project-check or review-frame workflow while fixing the assembly path. Keep future capabilities out of the shipped-feature list.

## 4. The sharing mechanism

Build a **Premiere Workflow Challenge** around one small sample project that visitors can download without submitting an email address. Use owned or redistribution-licensed media.

The loop is: **watch a result → download the same project → complete the workflow → share a variation → another editor tries it**. A useful recipe can circulate through team chats even when a public post does not spread widely.

Each workflow kit should contain:

- A real 45–60 second screen recording and a 3–6 minute walkthrough.
- A sample project, media manifest, tested version matrix, and expected result.
- A plain-language prompt plus its assumptions and required capabilities.
- A recipe that previews its actions before any application.
- A troubleshooting path and a link to report the failing step.
- An optional, redacted result card with a link back to the public recipe. Users choose whether to share it; never add a watermark to their export or disclose project details automatically.

For the first recording, show the finished result in seconds 0–3, the task and source clips in seconds 3–10, the preview in seconds 10–25, application and playback in seconds 25–45, and the sample-project link in the final seconds. Clearly label speed changes and edits to the recording. Retain an uncut companion capture. Existing illustrated assets can explain architecture; they should not substitute for this evidence.

Turn each validated kit into one YouTube tutorial, three short clips with different openings, one illustrated workflow article, one GitHub Discussion, and one technical explanation for developers. Reuse the evidence, but adapt the writing to each audience.

Suggested opening hooks, to use only once the recording supports them:

- “These are the source clips. This is the Premiere timeline my assistant assembled.”
- “I asked my assistant to check this sequence before handoff. Here is what it found.”
- “The same Premiere project, a different prompt, and a different result. Try the project yourself.”

Publish community variations with their creators’ permission and credit. Invite recipes, fixtures, translations, and troubleshooting improvements as contributions. Recognition should reward useful work, not stars or favorable reviews.

## 5. SEO: capture actual editor intent

Prioritize fit and successful installation over theoretical traffic. Keyword volumes and difficulty were unavailable; the following ordering is a testable intent hypothesis. Confirm it with Search Console and working keyword data before expanding investment.

| Priority | Query cluster | Destination | Brief and conversion |
| --- | --- | --- | --- |
| P0 | Premiere Pro MCP; MCP server for Premiere | Existing homepage, with the existing explainer handling definition intent | Clear product identity, real demo, supported installation route; start setup |
| P0 | Claude Premiere Pro; connect Claude to Premiere | Existing Claude Desktop setup article | Current downloadable artifacts, separate connector step, exact first prompt, recovery screenshots; verified connection |
| P0 | Premiere Pro automation; automate Premiere workflow | Existing workflow-automation article | Three demonstrated recipes with inputs and outputs; choose a workflow |
| P1 | AI video editing with Premiere Pro | Existing AI-editing article | Explain native Adobe tools, plugins, and MCP with concrete fit examples; try one supported task |
| P1 | Adobe Premiere AI Assistant vs MCP | Existing comparison article | Dated vendor-sourced comparison: client choice, setup, execution path, workflow coverage, and data handling; choose the appropriate route |
| P1 | Premiere project checklist; organize Premiere project | Existing Project Intake landing and supporting checklist | Keep the landing for the template/product and the article for the procedure; download a sample template |
| P1 | Premiere export QC; loudness check; black frames | Existing delivery-QC guide | Actual defective fixture, report, interpretation, scope; run the sample check |
| P1 | Premiere review frames; timeline contact sheet | Existing visual-review guide | Annotated output, source positions, reusable handoff recipe; reproduce the frame pack |
| P1 | Premiere MCP not connecting; CEP panel missing | Proposed `/docs/troubleshooting/` | Error-specific steps organized by client, OS, connector, and Premiere version; recover setup |
| P1 | Codex Premiere Pro; Cursor Premiere Pro | Proposed client-specific guides if install steps are materially different | Independently tested configuration and diagnosis; do not generate near-identical pages for client names |
| P2 | ChatGPT Premiere Pro; ChatGPT MCP setup | Proposed guide only when the connection route can be documented accurately | Explain local versus remote connectivity and current authentication/pairing requirements; no implication that the public endpoint automatically controls a visitor’s desktop |
| P2 | Premiere lower thirds automation; batch MOGRT | Proposed recipe page after host validation | CSV input, required After Effects setup, generated graphic, verified Premiere handoff; try the kit |

Keep one primary page per intent. Put synonyms and closely related questions on the same useful page. Do not publish “AI Premiere,” “Premiere AI,” and “Premiere Pro AI” as three duplicate articles. Review query-to-page overlap before adding routes.

**Every priority article gets an evidence upgrade:** direct answer, exact prerequisites, recorded result, reproducible steps, expected output, troubleshooting, relevant limitations, named author/reviewer, genuine review date, and a task-specific CTA. Embed a video transcript where useful. Link from the workflow hub to the article and back to the matching install or recipe step. Avoid making every page end in the same generic GitHub button.

**Technical work:** retain working canonicals, sitemap, robots, and server-rendered content; inspect Search Console coverage and any generative-search inclusion controls; confirm production WAF behavior permits intended search crawlers; measure mobile field performance; defer heavy video playback until requested; use accurate social previews; ensure redirects and internal links remain clean. Add valid `VideoObject` data for real videos where appropriate and maintain accurate software/organization metadata. These are improvements to an existing foundation, not evidence that indexing is currently broken.

Keep useful visible FAQs, but do not make FAQ rich-result markup a growth project: Google’s update log says FAQ rich results ceased appearing May 7, 2026. [Google documentation updates](https://developers.google.com/search/updates).

## 6. AI SEO and GEO: make the project easy to find and cite accurately

Use **AI SEO** for discovery through AI-enabled search and **GEO** for accurate inclusion and citation in generated answers. The work substantially overlaps with SEO, original evidence, and public distribution. It is not a separate keyword-stuffing program.

1. **Maintain a clear source of facts.** Generate the facts page, release-specific capability counts, compatibility table, installation paths, and AI reference files from reviewed data. Expose human-readable HTML first. Separate “released,” “present in current source,” and “demonstrated on these hosts.”
2. **Answer the questions people need to choose and install.** Explain what the project does, how Claude connects, what remains local, how UXP differs from CEP, which workflows are preview-only, and whether a given client needs a remote server. Concise summaries help readers; there is no magic paragraph length.
3. **Publish original evidence that others can reference.** A host matrix, reproducible workflow fixture, actual failure/recovery guide, and measured task comparison are more distinctive than a generic “10 AI editing tools” article. When publishing time savings, include setup, human review, hardware, versions, sample size, failures, and both workflows’ inputs.
4. **Keep crawl policy deliberate.** The current robots file already allows named AI agents. Verify access through the actual delivery layer. OpenAI distinguishes search crawling through `OAI-SearchBot` from training crawling through `GPTBot`; training permission is not required to permit ChatGPT search discovery. [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots).
5. **Maintain `llms.txt` as a useful reference.** Correct its current drift and keep it generated. Allocate a small maintenance task to it. Google explicitly says it does not use these files for ranking or generative-search visibility, and that special schema or AI-only writing is unnecessary. [Google AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).
6. **Earn independent explanations.** Give educators and maintainers reproducible material so their articles, videos, and directory entries can describe the product accurately. Placement does not guarantee citation or ranking. Avoid fabricated reviews, planted forum mentions, and mass-produced comparisons.

Use AI internally to draft transcripts, propose article outlines from validated workflows, identify conflicting facts, cluster actual support questions, and prepare translation drafts. Require a technical editor to check commands and claims; obtain human language review before promoting translated setup paths.

Run a small, fixed discovery audit weekly: 12 prompts across ChatGPT Search, Google’s available AI search experience, Bing/Copilot, and Perplexity. Example prompts include “How do I connect Claude to Premiere Pro?”, “What can I automate in Premiere with MCP?”, “Does Premiere Pro MCP upload my footage?”, “How do I fix a Premiere MCP connection?”, and “What is the difference between Adobe AI Assistant and Premiere MCP?”

Record date, engine/model when visible, locale, exact query, brand mention, cited URL, claim accuracy, and whether the answer recommends the right setup path. Keep branded and unbranded questions separate. Treat this as a directional sample, not market share; rerun surprises because answers vary.

Use available Search Console generative-AI reporting alongside standard search data. In Bing Webmaster Tools, inspect AI Performance citations, cited pages, and grounding queries. These reports describe their supported surfaces, not all AI usage. [Google measurement guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [Bing AI Performance](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview).

## 7. Distribution sequence and launch copy

| Channel | What to publish or offer | Cadence during launch | Success signal |
| --- | --- | --- | --- |
| GitHub README and Discussions | Short actual demo, “try this project,” supported install route, pinned troubleshooting discussion | Refresh for the flagship kit; weekly useful update | Setup actions, reproducible reports, recipe contributions |
| YouTube | Searchable tutorial plus downloadable project and pinned setup link | One substantial tutorial and three derivative shorts per week once evidence production is repeatable | Qualified referral sessions and reported completions |
| X, Bluesky, LinkedIn | Native clips; creator framing for X/Bluesky, workflow/team framing for LinkedIn | Three useful posts per week total, adapted by channel | Visits to the matching recipe and setup actions |
| Premiere/video-editor communities | A concrete workflow, sample, limitation, and useful answer to a real question | One relevant contribution per community per week at most; follow current rules | Discussion quality and successful reproduction |
| Educators and newsletters | An individualized demo kit with an angle relevant to their audience | Research five well-matched prospects per week; outreach only when authorized | Independent walkthroughs and relevant referral traffic |
| MCP discovery surfaces | Accurate installable local package metadata and matching documentation | Verify or complete one relevant listing at a time | Public listing verification and qualified referrals |
| Show HN or Product Hunt | A working launch with live maintainer support, project download, and clear boundaries | One event after successful external installs | Editors reaching first value; useful technical feedback |

For directory work, start with the official MCP Registry, then verify existing Glama/MCP Toplist identity and pursue a small number of relevant client/community catalogs. Distinguish “submitted” from “listed.” The official registry hosts metadata and checks the underlying package identity; validate the exact npm package and record before any publication. Marketplace distribution is its own install/review process. [MCP Registry quickstart](https://modelcontextprotocol.io/registry/quickstart).

Draft launch title:

> Show HN: An open-source Premiere MCP workflow you can reproduce with the included project

Draft social copy, after the demonstration passes:

> I connected my AI assistant to Premiere and gave it one defined editing task. Here is the preview, the resulting timeline, and playback. The sample project and workflow are included so you can try the same steps. Free and open source; Premiere and a compatible AI client are required. [Verified workflow URL]

Draft educator outreach, not sent:

> I maintain MCP for Adobe Premiere Pro. I put together a reproducible [workflow] demo with the project files, an uncut recording, tested versions, and setup steps. It may fit your tutorials on [specific topic]. You are welcome to test it independently and show where it works or fails. Here is the kit: [verified URL].

Use lowercase UTMs, for example `utm_source=youtube&utm_medium=organic_social&utm_campaign=workflow_challenge_01&utm_content=product_spot_short_a`. Keep public campaign values free of personal identifiers. Ask for a star only after delivering value; never require one to download, install, or contribute.

## 8. Product work that improves marketing conversion

| Order | Deliverable | Acceptance criterion | Why it matters |
| --- | --- | --- | --- |
| 1 | Release-fact synchronization | Released package, facts, README, structured data, and AI files agree; main-only features are labeled separately | Prevents contradictory recommendations and stale setup advice |
| 2 | A verified first-workflow kit | An external editor can reproduce one documented outcome with the release artifacts | Converts interest into evidence |
| 3 | Onboarding and recovery polish | Five outside testers; each setup failure has an actionable recovery path; existing bundle/connector steps are clear | Reduces abandonment after a compelling demo |
| 4 | Public recipe gallery | Start with three tested recipes, each with fixture, capabilities, preview, result, and support matrix | Creates shareable units and useful search destinations |
| 5 | Result sharing | Users can deliberately export a redacted workflow summary and public recipe link | Gives successful use a natural referral path |
| 6 | Compatibility and evidence page | Version-specific passes/failures, test dates, and scope; no universal success badge | Helps editors and AI answers choose the right path |
| 7 | Client-specific quick starts | Document only independently tested configurations; keep a working fallback | Opens new acquisition audiences without adding misleading promises |
| 8 | Contributor workflow | Recipe template, example fixture, review checklist, and approachable issues | Lets the community expand demonstrations and support |

Build on current recipe search/preview and doctor-repair foundations. Do not reimplement them as new marketing infrastructure. Add a capability because it unlocks a measured user outcome, not because it raises the advertised tool count.

## 9. Calendar, owners, and effort

Roles can be combined in a small team: maintainer for product/release work; editor for host tests and demonstrations; content/growth owner for articles and distribution. Start with organic channels and existing tools. Planning assumption: 15–20 hours per week total. No media spend is required or authorized by this document.

| Window | Maintainer | Editor | Content/growth | Exit criterion |
| --- | --- | --- | --- | --- |
| Days 1–3 | Reconcile release facts and install links; capture baseline | Choose disposable fixture and test matrix | Audit existing query/page ownership; prepare message and kit outline | One accurate install destination and campaign claim sheet |
| Days 4–7 | Fix failures exposed by outside testers | Test project check and product spot; retain recordings | Refresh Claude setup, automation, and facts pages; prepare clips | Five outside testers attempted setup; one reproducible workflow passes |
| Days 8–14 | Package sample and troubleshooting fixes | Record tutorial and three short variants | Publish kit; begin owned/community distribution and authorized individualized outreach | Kit is public; every promotional link works; feedback has an owner |
| Days 15–21 | Finish recipe entry points and validate registry metadata | Record review-frame or delivery-QC workflow | Upgrade two existing guides; pursue qualified coverage | Second reproducible kit and first independent reproduction |
| Days 22–30 | Resolve recurring install failures | Support an external walkthrough | Choose the best-performing hook; prepare one broader launch | Launch only if independent users can complete the promised workflow |
| Days 31–60 | Ship the highest-impact setup/recipe improvements | Produce one evidence-backed kit every two weeks | Expand winning tutorial and search clusters; publish contributor work | Three to five useful kits and measurable repeat use in a consented cohort |
| Days 61–90 | Improve the workflow retained users value most | Publish a measured case study | Scale the two strongest channels; add translations only where demand and review capacity exist | Repeatable acquisition-to-value process and a next-quarter decision |

Weekly effort split: roughly 40% product/host proof, 30% demonstrations, 20% distribution and support, and 10% search/measurement. During weeks 1–2, move time from distribution to onboarding if testers cannot complete setup.

At day 30, choose whether to expand reach or fix activation. At day 60, choose whether to expand use cases or deepen the one that retains users. Revenue research can follow repeated team use; paid tiers and creator sponsorships are separate decisions.

## 10. Scorecard and experiment rules

**Primary outcome:** editors completing a supported, observable workflow each week. The current anonymous event design cannot count unique active editors or connect browser acquisition to a local workflow. Initially measure this outcome through a voluntary tester cohort and report its sample size; keep anonymous runtime totals as a separate operational signal.

| Measure | How to use it | Initial planning target, not forecast |
| --- | --- | --- |
| External first-use success | Observed testers completing one kit / testers attempting it | At least 4 of 5 before broad launch; disclose the small sample |
| Time to first result | Median plus slow/failing cases; report install time separately from already-installed use | Median under 15 minutes in the first tester cohort, including required setup steps; revise after baseline |
| Workflow repeat use | Consented testers repeating a useful workflow within seven days | At least 5 of the first 10 completers; investigate reasons when lower |
| Independently verified use | Voluntary reports with bounded host/version/outcome evidence | 10 editors by day 30; 30 by day 60; 75 by day 90 |
| GitHub reach | Weekly stars, views, referral changes; use comparable time windows | Stretch milestones: 350, 600, and 1,000 total stars at days 30/60/90; do not sacrifice activation to hit them |
| Search acquisition | Actual impressions, clicks, query-to-page matches, setup actions | Establish baseline in week 1; month-on-month improvement in qualified visits and actions |
| AI discovery | Citation/mention and accuracy in fixed prompt sample; provider reports where available | Establish baseline first; aim for more correct citations, not mentions alone |
| Earned distribution | Independent tutorials, useful links, attributable qualified traffic | Three independent reproductions or tutorials by day 60 |
| Support load | Failed step, host/client, recovery outcome, maintainer time | Recurring failure reasons decline as the tester sample grows |

Do not add user identifiers, prompts, paths, media names, or opaque click IDs to the existing analytics contract. Landing actions and local first-run checks currently have no shared identifier. Report “download clicked,” “prompt copied,” “runtime ready check,” and “observed workflow completed” separately. A runtime-ready event is not an edit-success event. [Existing measurement contract](https://github.com/leancoderkavy/premiere-pro-mcp/blob/c51e9e9ea95bbf2af9b2c71232d24177e19dcbdf/docs/activation-measurement.md).

Run three bounded experiments:

1. **Demo opening:** compare result-first, problem-first, and prompt-first clips using the same workflow and destination. Judge qualified visits and setup actions per 1,000 views, not views alone. Review after roughly 1,000 views per variant or two weeks; low-volume results are directional.
2. **Entry point:** compare “Try the sample project” with “Install the connector.” Measure browser actions within that stream and collect separate voluntary completion feedback. A sequential test is acceptable at low traffic; do not claim statistical significance.
3. **Workflow choice:** compare project check, product spot, and review frames in the tester cohort. Prioritize the one people repeat and recommend. One impressive completion is weaker evidence than repeated successful use.

Decision rules: high views with few qualified visits means the hook or audience needs work; many downloads with setup failures means onboarding needs work; successful setup with little repeat use means the workflow needs work; search impressions with weak clicks suggest title/intent issues; traffic with low task completion suggests the destination needs work. Do not respond to every problem by publishing more articles.

## 11. The first seven deliverables

1. One release-specific fact source and synchronized public claims.
2. One fixture that supports a complete, observable workflow.
3. Five external installation attempts with documented recovery issues.
4. One actual Premiere walkthrough and three short edits from it.
5. Three upgraded existing pages: setup, workflow automation, and facts.
6. One downloadable recipe kit plus a prepared registry record and distribution list.
7. One weekly scorecard that separates attention, setup activity, runtime readiness, and real workflow success.

The intended result is a repository people can discover, understand, try successfully, and recommend because the workflow is useful.
