# Feature editing workflows: research and implementation plan

Research checked September 8, 2026. Audience: editors, assistant editors, and the Premiere Pro MCP team. Recommendation: build a configurable feature editorial workspace, starting with reliable scene preparation and footage retrieval, then creative comparison, then department handoffs.

This is a fresh synthesis of the [September 6 research draft](film-editor-workflow-research-plan-2026-09-06.md), checked against public interviews, published timeline images, current Adobe documentation, and local source at `5038b4d`. The older draft is preserved. The layouts and implementation packages below are proposals, not existing product capabilities or exact replicas of film projects.

Publication context checked September 8, 2026: the earlier research is merged in [PR #476](https://github.com/leancoderkavy/premiere-pro-mcp/pull/476). [PR #479](https://github.com/leancoderkavy/premiere-pro-mcp/pull/479) is open with coverage and turnover inspection foundations; consult that PR for implementation progress. The build sequence below describes the target workflow and does not imply that every package is still unstarted.

## What to learn from the films

“Best” means accomplished film teams with concrete, publicly documented practices worth adapting. This is not a ranking of artistic quality or a claim that one editor's method suits every film. Most detailed timeline examples here are Avid projects; their editorial principles transfer to Premiere, but their host operations require separate validation.

| Film / team | Documented practice | Recommended application |
| --- | --- | --- |
| **Dune: Part Two — Joe Walker, Chris Voutsinas, Mercédesz Czanka** | Assistants prepared overlapping sections of roughly 30–40 seconds across setups, retaining good and weak takes. Walker raised favored picture moments and marked preferred audio separately, then discussed his priorities with collaborators. | A complete coverage index with optional beat stringouts, independent picture/audio selects, and an editor's brief for an assistant's scene assembly. [Team interview](https://borisfx.com/blog/AOTC/art-of-the-cut-dune/) |
| **Whiplash / La La Land — Tom Cross** | Cross describes setup rows in thumbnail view, abbreviated script notes, watching all scene dailies, markers for conventional dialogue, and selects sequences for action or montage. These are evolving preferences discussed across his work. | Offer visual setup browsing, source markers, and selects sequences as separate review choices. [Cross interview](https://www.provideocoalition.com/art-cut-tom-cross-ace-whiplash-joy-la-la-land/amp/) |
| **Oppenheimer — Jennifer Lame, Mike Fay, Nick Ellsberg, Tom Foligno** | A filmed take could span several script scenes. The team prepared scene-specific references and explanatory notes; abstract material also had thematic collections. | Represent source footage, script scenes, and themes separately, with multiple references to the same source range. [Team interview](https://borisfx.com/blog/aotc/art-of-the-cut-oppenheimer/) |
| **Mission: Impossible – Fallout — Eddie Hamilton and team** | The published legend distinguishes VFX awaiting supervisor/editor review, accepted versions, plates with turnover handles, version history, and a previous color-turnover reference. | Give every VFX shot an explicit state and accountable reviewer; compare picture changes against the department's exact supplied cut. [Track breakdown](https://www.provideocoalition.com/aotc-mi-timeline/) |
| **Barbie — Nick Houy, first assistant Nick Ramirez, and team** | The timeline separates rough, active, alternate, and turned-over VFX, tracking, change notes, and final color. They retained eight reels because a late rebalance would burden sound. | Support viewing profiles and report downstream costs before moving reel boundaries. [Team interview and legend](https://borisfx.com/blog/aotc/art-of-the-cut-barbie/) |
| **Everything Everywhere All at Once — Paul Rogers** | Rogers describes Premiere Productions, synchronized remote media, Frame.io notes, and temporary VFX during editing. His account includes composites that later needed identifying for VFX work. | Make collaborations version-specific and record editorial composites/retimes as department tasks while creative work proceeds. [Rogers interview](https://filmmakermagazine.com/117831-kept-in-sync-paul-rogers-on-editing-everything-everywhere-all-at-once/) |
| **Mad Max: Fury Road — Margaret Sixel** | Screenings exposed audience expectations and pacing problems. Sixel describes reducing repetitive action and reassessing a scene's performance choices within the whole film. | Compare alternatives for character, clarity, progression, and audience understanding; review scene, reel, and whole-film context. [Sixel interview](https://www.provideocoalition.com/art-cut-margaret-sixel-editor-mad-max-fury-road/) |

Assistant-editor work needs equal attention. Ruth Antoine describes reconciling camera/script/lab reports with received takes, syncing and preparing bins to the editor's preferences, anticipating sound needs from the script, and preparing screening sound. Our adaptation is a daily readiness report, exception queue, and scene resource pack. A filename gap should trigger reconciliation, not an automatic claim that footage was lost. [Antoine interview](https://blog.frame.io/2021/05/26/art-of-the-cut-great-assistant-editor/)

## What the published timelines establish

I downloaded and visually inspected **Barbie Reel 1** and **Oppenheimer Reel 6** during this pass, and read their accompanying explanations. Images establish visible arrangement; interviews establish the intended roles. Neither reveals a complete private project or proves an automation interface.

- **Barbie:** the image visibly labels final color, notes, titles, VFX tracker, rough/active/turned-over/alternate VFX, dialogue, ADR, effects, and music. The prose legend overlaps ADR and mono effects at A11; the screenshot places ADR5 at A11 and mono effects at A12–A14. Treat this as a source inconsistency, not a template to copy literally. [Original image](https://21305637.fs1.hubspotusercontent-na1.net/hubfs/21305637/AOTC/BARBIE/R1.png)
- **Oppenheimer:** the image shows layered picture treatments, detailed dialogue work, and long sound/music returns. The written legend explains native-format picture on V1–V5 and 2.20 extractions above. Preserve an explicit viewing configuration when several aspect ratios coexist. [Original image](https://21305637.fs1.hubspotusercontent-na1.net/hubfs/21305637/AOTC/Oppenheimer/GADGET_R6.png)
- **Fallout:** the written breakdown supplies particularly useful operational detail: plate boundaries reveal exhausted turnover handles, while a prior DI reference exposes subsequent edits. Adopt these checks without requiring its complete track count. [Hamilton's explanation](https://www.provideocoalition.com/aotc-mi-timeline/)
- **Top Gun: Maverick:** Hamilton publishes seven reel timelines. These provide an additional reference for reel-based organization; this pass checked the publication page, not every full-resolution image. [Hamilton's timeline gallery](https://www.eddiehamilton.com/timelines)

The design implication is that tracks can communicate both media roles and production status. Those meanings should also be recorded as data so a hidden track, flattened export, or color change cannot erase them.

## The proposed working day

1. **Assistant prepares the scene.** Reconcile incoming media against reports; check sync and channels; preserve original source identity; assign script-scene references; prepare the editor's chosen review format. Deliver a readiness summary with unresolved exceptions.
2. **Editor learns the material.** Review all relevant coverage, including reactions, silence, movement, and material beyond dialogue. Make personal selections; keep preferred sound independent of preferred picture.
3. **Editor builds the dramatic idea.** State the scene's point of view, turning point, essential moment, and open question. Assemble, then make named alternatives such as “delay reveal” or “hold reaction.”
4. **Assistant supports the cut.** Work from an identified scene/reel revision to prepare sound, temp VFX, or an assigned alternate. Return a changed-items report and explicit outstanding requests.
5. **Editor and director review in context.** Watch the scene, reel, and relevant surrounding material. Use silent picture, dialogue, and working-mix passes where helpful. Decide which version becomes current.
6. **Assistant freezes the handoff.** Prepare the screening or department copy, verify its picture/audio configuration, record the exact version, and reconcile returns. Later picture changes issue a new change report.

This division leaves room for assistants to cut scenes and editors to make their own selects. Ownership describes responsibility for a particular task, not a rigid creative hierarchy.

## Organization to use

Proposed project/bin template:

```text
00_ADMIN        show policy, script revisions, reports, owners, change log
01_DAILIES      shoot day / camera roll / original source references
02_SCENES       scene / coverage / review sequences / selects
03_EDITORIAL    scene cuts / alternatives / reels / full-film assemblies
04_SOUND        production sound / ADR / FX / ambience / music / returns
05_VFX          shot ID / plates / incoming / review / accepted / history
06_REVIEW       dated screening versions / notes / decisions
07_TURNOVERS    department / turnover ID / reference / manifest / returns
08_DELIVERY     approved versions / export settings / QC
09_ARCHIVE      superseded cuts and historical handoffs
```

For a small project use bins; for a collaborative feature divide work into appropriately owned projects within a Premiere Production. Adobe documents project locking to prevent collaborators changing a project already opened for editing. A workflow must check actual ownership rather than assume two sequences in one project are independently writable. [Adobe project locking](https://helpx.adobe.com/premiere/desktop/organize-media/create-projects/project-locking-with-multiple-open-projects.html)

Camera originals and verified backups remain in separately managed storage. Bin organization is not backup verification. Retain camera filename, reel/card, source timecode, rational timebase, and channel mapping alongside friendly names. Do not rename physical originals merely to tidy a bin.

Example names: `FILM_SC042_COVERAGE_v001`, `FILM_SC042_SELECTS_v003`, `FILM_SC042_ALT_DELAY_REVEAL_v001_AB`, `FILM_R03_CUT_v018_AB`, `FILM_R03_TO_SOUND_20260908_v001`. Store sequence ID, revision, parent version, owner, and timebase in the manifest; names alone do not establish the current cut.

## Editor timeline and review modes

Start with this compact, configurable cut layout. Expand channels and tracks to the show's needs; these numbers are our proposal.

| Tracks | Role |
| --- | --- |
| V1–V2 | Main picture and overlaps |
| V3–V4 | Editorial composites and temporary VFX |
| V5 | Intended titles and graphics |
| V6 | Review overlays, excluded from clean output |
| A1–A4 | Production dialogue |
| A5–A6 | ADR and temporary dialogue |
| A7–A10 | Sound effects |
| A11–A12 | Ambience and room tone |
| A13–A16 | Music |

Track type, source microphone identity, and output routing are explicit choices. Four dialogue tracks will not fit every production. Returned stems need their own role and deliberate playback selection to avoid doubling the original tracks.

Keep **review sequences** separate from the cut layout: lifting a clip to V3 in a selects sequence can mean “preferred”; V3 in a cut can mean “composite.” Store the meaning with the sequence profile and display its legend.

| Review mode | Choose it when | Required behavior |
| --- | --- | --- |
| Setup board + source markers | Conventional dialogue and manageable coverage | Browse setups/takes; retain source notes and marked moments |
| Full scene stringout | Discovering the coverage or working with improvisation | Account for included and excluded footage; recover original context |
| Line comparison | Comparing alternate readings | Group readings with surrounding context; retain non-dialogue material elsewhere |
| Overlapping beat sections | Long performances or complex scenes | Group all setups for a dramatic beat; identify intentional review overlap |
| Action/montage selects | Visual construction and movement | Group by action/beat; retain shot geography and movement notes |

For footage review, colors may identify cameras; for a VFX review, they may identify status. Each view gets one declared meaning and a written legend. Color never constitutes approval by itself.

## Assistant editor timelines

These are proposed working templates, not claims about private film projects.

| Sequence | Suggested arrangement | Exit condition |
| --- | --- | --- |
| `SYNC_QC` | Picture above associated production channels; slate and exception markers | Head/tail sync and channel identity checked; MOS/wild tracks identified |
| `SCENE_COVERAGE` | Setup/take order with source identifiers and scene boundaries | Every expected take is accounted for or listed as an exception |
| `BEAT_COMPARE` | Sections arranged horizontally; preference lanes above; independent audio preferences below | Editor's priorities and intentional overlaps recorded |
| `SOUND_PREP` | Duplicate of the exact cut; distinct dialogue, ADR, FX, ambience, music, returns | Channel continuity, temp status, playback selection, and rough mix reviewed |
| `VFX_REVIEW` | Accepted reference, new candidate, plates/handles, identifiers and notes | Shot/version, range, reviewer, and next state recorded |
| `TURNOVER_CHECK` | Frozen outgoing reference and returned version, clearly labeled for comparison | Frame alignment, duration, missing media, and exceptions reconciled |

A VFX-oriented feature can add more working tracks, but state belongs in the shot record: received → technical check → supervisor review → editorial review → accepted → sent to named department. Rejected and superseded versions remain recoverable. “Newest” does not imply accepted.

## Build plan for Premiere Pro MCP

Current source provides a useful base. [`src/workflows/catalog.ts`](../../src/workflows/catalog.ts) already advertises intake, organization, reviewed stringouts, context planning, and delivery workflows. [`src/tools/project-intake.ts`](../../src/tools/project-intake.ts) implements bounded read-only intake. [`src/ai/editorial-plan.ts`](../../src/ai/editorial-plan.ts) and [`src/tools/editorial-plans.ts`](../../src/tools/editorial-plans.ts) provide evidence-bound planning and guarded organization application. These findings are source inspection, not proof of complete live workflows.

Important existing limitation: intake captures a numeric frame rate and can fall back to project name as identity. Neither is sufficient by itself for authoritative frame mapping and cross-project mutation. Confirm stronger identity/timebase evidence before those operations. The [intake design document](project-intake-workflow.md) also needs reconciliation with the existing tool during implementation.

| Order | Work package | Concrete deliverable and acceptance gate |
| --- | --- | --- |
| **P0.1** | Feature profile + coverage model | Versioned profile for names, track roles, owners, timebases and review preferences. Source-range-to-script-scene relationships allow one take to span several scenes. Incomplete intake stays explicitly incomplete. |
| **P0.2** | Read-only preparation and review plans | Scene readiness report plus selectable marker/stringout/line/beat plans. Every proposed range traces to verified source evidence; all omissions and intentional overlaps are visible. |
| **P0.3** | Create and validate one review sequence | Use supported host actions to create a new sequence from approved ranges. Read back identities and ranges; verify playback, save/reopen, Undo where supported, and interruption recovery. Preserve the source cut. |
| **P1.1** | Human selects + scene alternatives | Independent picture/audio preferences, editor's brief, version lineage, and change comparison. Reject stale application; retain an old alternate for review. |
| **P1.2** | Screening profiles + revision-bound notes | Explicit picture/aspect/mix/overlay configuration; notes bound to exact versions. Edits remap notes only when identity/range evidence is reliable. |
| **P1.3** | Department turnover preparation | Frozen manifest, references, source/channel details, handles, retime/effect exceptions, and receiving specification. Test one receiving workflow end to end before adding others. |
| **P2** | VFX replacement + returned conform | Preview affected occurrences, validate handles/timebase, apply supported replacements, preserve accepted versions, and compare returns to the exact turnover. |

Build prompts on shared models before multiplying tools. Proposed user-facing entries: “Prepare today's dailies,” “Show every reading of this beat,” “Build my scene review,” “Compare these alternatives,” “Prepare a screening,” and “Show changes since sound turnover.” These are proposed workflow labels, not callable tool names.

The first milestone should deliver **a feature profile, a read-only coverage index, and a complete review-sequence preview**. This is useful before advanced host automation and establishes the source relationships needed by every later stage. A second milestone proves one review mode in Premiere before expanding modes.

Keep planning, host execution, and verification separate. Reuse existing preview/confirmation contracts; validate live project, sequence, ownership, and source identities immediately before application. Multi-command mutations can be partially committed: record actual completed operations and re-inspect after interruption rather than silently replaying them.

AAF is a specific feasibility gate. Adobe currently documents unsupported merged clips and a Windows failure limit for embedded AAFs above 2 GB; separate audio preserves more metadata. Record recipient requirements for handles, channelization, sample rate, effects and references, then validate the receiving application's import. Do not advertise a universal sound-turnover preset. [Adobe AAF export, updated August 18, 2026](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-aaf-files.html)

## Pilot and success measures

Use owned or licensed footage for one dialogue scene, one action scene, and one VFX scene. Include duplicate filenames, missing sound, a proxy mismatch, mixed timebases, a slate spanning multiple script scenes, separate picture/audio preferences, a retime, a transition, a stale note, and a rejected VFX version.

Compare against a recorded manual baseline: time to prepare a scene, retrieve a requested alternate, compare two cuts, and prepare a turnover. Track missing/duplicate range counts and the number of unresolved exceptions separately from speed. Set performance targets after that baseline; no speedup is established by this research.

Required results: all approved ranges accounted for; no unrequested change to the original cut; unknown evidence remains unknown; stale application is refused; save/reopen retains intended structure; rendered picture and sound match the chosen profile; an editor and assistant find the workflow useful. A sound-turnover milestone additionally requires a successful recipient re-import and reconciliation.

Planning tests, host structure readback, playback/export review, and receiving-department acceptance are separate evidence levels. No implementation, production media changes, or licensed-host testing were performed for this research plan.

## Evidence limits and next decision

Research used direct practitioner interviews, two inspected timeline images, Hamilton's published gallery, and Adobe's current documentation. It supports workflow patterns, not a universal film template. Private AE projects, facility delivery specifications, and automation feasibility for every proposed action remain unavailable or untested.

The next useful step is implementing P0.1–P0.2 and reviewing their output with an editor/assistant pair. Further general interviews are unlikely to change the core recommendation: preserve complete footage access, let review methods vary, and make every creative or department handoff traceable to its exact cut.
