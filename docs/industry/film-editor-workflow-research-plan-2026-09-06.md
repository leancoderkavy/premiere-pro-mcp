# Film editor and assistant editor workflow plan

Research date: 2026-09-06; expanded research pass completed on the same date. Scope: documented feature-film editorial practices translated into a proposed Premiere Pro MCP workflow system. This is a research and implementation plan, not an implementation or live-host verification claim.

## Recommendation

Build a feature editorial workspace that makes footage retrieval, creative comparison, and department handoffs dependable. Give editors a focused creative view and assistants detailed preparation and verification views over the same source identities and revision history.

Expanded research changes the design: offer several footage-review methods, preserve overlapping script-scene references, let editors retain hands-on selects work, and track the downstream effects of picture changes. Read the expanded findings and revised build order below alongside the original six workflows.

“Best” here means useful, well-documented examples from accomplished film teams, not an objective ranking of films. A complicated final timeline is a record of a production's needs; its track count alone is not a useful template.

## What the film teams actually describe

| Reference | Documented practice | Proposed adaptation |
| --- | --- | --- |
| Paul Rogers — Everything Everywhere All at Once | Watches scene and broader footage stringouts; browsing can reveal unexpected material. Experiments with different tonal treatments. | Preserve complete coverage alongside curated selects; create named alternate cuts with explicit creative questions. |
| Eddie Hamilton — Mission: Impossible – Fallout | Published track legend separates picture processing, VFX review stages, shot identifiers, plate handles, DI tracking, and returned checks. Audio separates dialogue, effects, music, and final stems. | Store role and status explicitly; provide separate creative, VFX, and turnover views. |
| Eddie Hamilton — Top Gun: Maverick and Dead Reckoning | His own site publishes individual reel timelines: seven for Maverick and nine for Dead Reckoning. | Manage approved scene versions, reel versions, and full-film review versions as related but distinct objects. |
| Joe Walker — Dune | Builds rhythm with sound collaborators, sometimes starts from a pivotal performance moment, and reviews scenes without audio with Denis Villeneuve. | Support beat-based selects, sound experiments, and silent performance review. |
| Margaret Sixel — Mad Max: Fury Road | Describes removing repetitive action/story passages and reassessing performances in the context of the complete film. | Review whether each beat advances the scene; compare scene improvements against full-film consequences. |

Sources: [Rogers interview, Steve Hullfish, April 13, 2022](https://blog.frame.io/2022/04/13/art-of-the-cut-everything-everywhere-all-at-once/); [Hamilton's Fallout track breakdown, Steve Hullfish, August 1, 2018](https://www.provideocoalition.com/aotc-mi-timeline/); [Hamilton's published timelines](https://www.eddiehamilton.com/timelines); [Walker interview, Steve Hullfish, October 27, 2021](https://blog.frame.io/2021/10/27/art-of-the-cut-dune-joe-walker/); [Sixel interview, Steve Hullfish, 2016](https://www.provideocoalition.com/art-cut-margaret-sixel-editor-mad-max-fury-road/).

Assistant editing deserves its own design. In her interview, Ruth Antoine describes reconciling apparent missing clips against production reports, preparing dialogue and rough sound for screenings, and anticipating scene sound needs from the script. The useful pattern is a documented exception queue plus scene-ready resources. [Antoine interview, May 26, 2021](https://blog.frame.io/2021/05/26/art-of-the-cut-great-assistant-editor/).

For EEAAO, Rogers describes Premiere Productions, synchronized remote media, and shared review notes; the report also credits Zekun Mao and Aashish D'Mello with preparation that kept technical organization away from his creative work. This supports the separation of editor and assistant views. [Filmmaker Magazine interview](https://filmmakermagazine.com/117831-kept-in-sync-paul-rogers-on-editing-everything-everywhere-all-at-once/).

Evidence limitation: the first pass used Fallout as its strongest explicit track-by-track evidence. The expanded pass adds published track breakdowns and visual inspection of Barbie Reel 1 and Oppenheimer Reel 6. Hamilton's other published timeline pages establish reel examples, but the full-resolution Maverick image failed to load in the first pass. I did not inspect private project files or establish a complete AE track layout for each film. The templates below are recommendations, not replicas of those productions.

## Proposed organization

### Project and bin structure

Use this as a configurable starting point. For a small film these are bins; for a collaborative feature, divide suitable work into projects inside a Production.

```text
00_ADMIN          script versions, reports, naming rules, change log
01_DAILIES        shoot day / camera roll; original source identity
02_SCENES         scene / synced coverage / stringouts / selects
03_EDITORIAL      scene cuts / reel cuts / full-film assemblies
04_SOUND          production dialogue / ADR / effects / ambience / music
05_VFX            plates / incoming versions / review / accepted versions
06_REVIEW         dated screening versions / notes / decisions
07_TURNOVERS      department / turnover ID / reference / manifest
08_DELIVERY       delivery versions / QC reports
09_ARCHIVE        superseded cuts and historical handoffs
```

Keep camera originals in a separately managed media folder structure; project bins do not establish verified backups. Preserve original filenames, reel/card identity, source timecode, and channel mapping independently of friendly display names. Use stable IDs for operations.

Proposed sequence names:

```text
FILM_SC042_STRINGOUT_v001
FILM_SC042_SELECTS_PERFORMANCE_v003
FILM_SC042_CUT_v012_AB
FILM_SC042_ALT_HOLD_REACTION_v001_AB
FILM_R03_CUT_v018_AB
FILM_FULL_SCREENING_20260906_v002
FILM_R03_TO_SOUND_20260906_v001
```

Date and initials help humans; a manifest must also record the exact sequence ID, revision, parent version, timebase, and scene/reel membership. Never rely on a name such as FINAL to resolve authority.

For collaboration, use explicit ownership and handoff. Premiere Productions project locking prevents collaborators from writing over a project currently owned for editing. Do not assume two people can independently modify the same project simply because they are working on different sequences. [Adobe project locking documentation](https://helpx.adobe.com/premiere/desktop/organize-media/create-projects/project-locking-with-multiple-open-projects.html).

### Editor timeline template

Proposed compact starting layout; expand track groups for the show's channel requirements.

| Track group | Purpose |
| --- | --- |
| V1–V2 | Principal picture, overlaps and transitions |
| V3–V4 | Composites, inserts, temporary VFX |
| V5 | Titles and intentional on-screen text |
| V6 | Review overlays; disabled for clean output |
| A1–A4 | Production dialogue, preserving microphone identity |
| A5–A6 | ADR and temporary dialogue |
| A7–A10 | Sound effects |
| A11–A12 | Ambience and room tone |
| A13–A16 | Music |

Select mono, stereo, or multichannel track types deliberately. Track ranges are defaults, not guarantees that four dialogue tracks fit every recording. Audio role metadata and routing matter more than the number.

Use clip colors for one declared meaning within a view; retain written statuses as the authority. For example, a VFX review view may color by status, while a footage view may color by camera. Include a visible legend and never infer approval from color alone.

### Assistant editor timelines

Create distinct work sequences with clear owners and purposes:

| Sequence | What it contains | Completion evidence |
| --- | --- | --- |
| SYNC_QC | Prepared takes with relevant original sound channels | Sync checks at head and tail; exceptions logged |
| SCENE_STRINGOUT | All included coverage in explicit scene/setup/take order | Every included range maps back to its source; exclusions listed |
| PERFORMANCE_SELECTS | Human-selected moments grouped by beat or character | Source ranges, selector, notes, and selection revision |
| VFX_REVIEW | Current candidate, accepted reference, useful comparison material | Shot ID, version, reviewer, status, handles, and color assumptions |
| SOUND_PREP | Duplicate of an identified cut, prepared for sound | Dialogue/channel continuity and temp/final separation checked |
| TURNOVER_CHECK | Exact outgoing version and returned reference | Differences reviewed against the same turnover manifest |

These are preparation and review stages, not alternate authorities for the master cut. Promote accepted changes through an explicit version handoff.

## Six workflows to build

### 1. Dailies readiness and scene preparation

Assistant supplies the day's media scope and available camera, sound, lab, and script reports. Inspect observed metadata; reconcile expected versus present items; flag duplicates, missing sound, unsupported timebase evidence, and proxy uncertainty. Build a proposed scene assignment and a preparation checklist.

Output: readiness report, unresolved exceptions, scene index, and source provenance. A filename gap is a discrepancy to investigate, not proof of lost footage. Filesystem checksum and backup verification are separate capabilities that must be implemented or supplied as evidence.

### 2. Coverage stringouts and performance selects

Produce a complete coverage index first, then use the editor's chosen review method: source markers, complete stringouts, line comparisons, or overlapping beat sections. Creating a selects sequence is optional. Each selection carries source ID, rational source timebase, in/out range, script-scene references, take, beat, selector, and a short reason. Make room for reactions, movement, and silence; transcript matching alone cannot find all useful performances. Keep preparation separate from human ranking so editors can perform their own selects pass.

Output: a new, reviewed stringout and optionally a separate selects sequence. Unsupported multicam, retimed, or ambiguous mappings remain manual until validated. The editor can always recover excluded footage from the coverage index.

### 3. Scene construction and alternatives

Editor identifies the scene's point of view, change in the character's situation, pivotal moment, and uncertainty. Retrieve relevant selects and propose an assembly. Compare a small number of alternatives with named questions: hold the reaction longer, reveal information later, or remove a redundant beat.

Output: versioned alternatives and a decision record. Reassess in reel context before promotion. Human judgment owns performance, clarity, emotion, and rhythm; software may report durations and changes without pretending these measure quality.

### 4. Sound and performance review

Offer separate passes for silent picture, dialogue-focused review, and the working mix. Preserve the mix state when changing review modes. Track temporary ADR, music references, and unresolved sound requests so none disappear into a seemingly finished cut.

Output: time-anchored observations and sound tasks. Sound playback and exported output must be checked; metadata alone cannot verify sync, intelligibility, or intent.

### 5. VFX versions and editorial review

Use a state record such as received → technical check → supervisor review → editor review → accepted → turned over. Record responsible reviewers and allow rejection or supersession. A later file version does not automatically replace an accepted shot.

Output: a review queue and a preview of exact replacements. Validate source range, handles, frame count, timebase, and affected occurrences. Keep accepted references and prior versions recoverable. Treat retimes, transitions, nested clips, and multiple plates as explicit cases.

### 6. Screening notes and department turnovers

Freeze a named screening version. Associate each note with that sequence revision, frame/timebase, author, and decision. When edits move material, remap using reliable identity/range evidence or flag the note as ambiguous.

For sound, color, or VFX, prepare a manifest listing the exact cut, department requirements, references, source identities, handles, effects/retime exceptions, and output settings. Compare returned material against that frozen handoff. Department-specific exchange formats and re-import checks require separate adapters and live validation.

## Premiere Pro MCP implementation plan

Current source inspection found useful foundations in `src/workflows/catalog.ts`: intake preview, project organization, reviewed stringouts, context-aware plans, transcript workflows, and delivery verification. `src/tools/project-intake.ts` implements `preview_project_intake`; `docs/industry/project-intake-workflow.md` still states that no intake tool exists. Reconcile that stale statement before extending the contract.

| Order | Deliverable | Reuse / proposed addition | Acceptance gate |
| --- | --- | --- | --- |
| 1 | Feature template and read-only audit | Reuse intake evaluator and organization planning; add show policy, scene identities, track roles, ownership, and evidence states | Deterministic report; no mutation; unsupported fields remain unknown |
| 2 | Scene coverage and selects | Extend reviewed stringout planning with complete coverage ledger and beat-based selections | No missing or duplicated approved ranges; exact source mapping; new sequence only |
| 3 | Alternate-cut comparison | Reuse context/plan primitives; add version lineage and structural difference report | Original unchanged; stale versions rejected; affected media and duration changes explained |
| 4 | Screening notes and turnover manifest | Extend delivery planning with revision-bound notes and department requirements | Reproducible frozen handoff; ambiguous notes and unsupported exports reported |
| 5 | VFX queue and controlled replacement | Add shot/version/status ledger and supported replacement adapters | Correct shot and occurrences; preserved prior version; interrupted operation recovery |
| 6 | Live pilot and workflow catalog | Add discoverable editor/AE prompts and validation fixtures | Playback, save/reopen, recovery, and handoff round-trip evidence in Premiere |

Sequence the work by these gates rather than promising a calendar before host API feasibility is known. VFX replacement is deliberately after source mapping and revision control.

Keep workflow intent separate from host actions: a planner emits proposed operations; an adapter checks capability and exact identities; a verifier reads back actual results. Preserve the existing inspect → propose → preview → approve → apply → verify → receipt model. This plan authorizes no production media mutation.

Suggested future workflow labels, not currently callable tool names: Prepare feature dailies; Build scene coverage; Review performance selects; Compare scene alternatives; Review VFX updates; Prepare department turnover.

## Pilot and definition of success

Use owned or licensed test footage: one dialogue scene, one action scene, and one scene with temporary VFX. Include duplicate filenames, missing audio, an offline proxy, mixed timebases, a retime, a transition, a stale review note, and a rejected VFX version.

Measure a manual baseline, then compare:

- Time to retrieve a specified alternate performance and trace it to source.
- Time to prepare a scene for the editor and explain outstanding exceptions.
- Source-range fidelity and missing/duplicate coverage count.
- Time to compare two versions and prepare a reproducible turnover.
- Recovery after partial application, interruption, and save/reopen.

Required outcomes: all approved ranges accounted for; no unrequested change to the original cut; stale identities/revisions rejected; missing evidence reported; human editor review of scene clarity and performance; assistant review of organization and handoff usefulness.

Unit tests establish planning behavior. Premiere readback establishes exposed structure. Playback/export review establishes observable picture and sound. A receiving department's re-import and reconciliation establishes a tested handoff. Report these separately.

First implementation slice, revised after expanded research: a feature-film profile plus a read-only coverage index with overlapping scene references and selectable review modes. Include a complete stringout preview without requiring editors to use that mode. This creates the identity foundation needed by every later workflow.

## Expanded research: what changes the plan

### Footage review must adapt to the editor and the material

**Tom Cross — interview covering Whiplash, Joy, and La La Land.** Cross describes thumbnail rows organized by camera setup and abbreviated script-supervisor comments alongside takes. He watches the scene's dailies before cutting. Traditional dialogue usually gets source markers; action and montage get selects sequences. This is evidence against making every scene use the same review format. These are his stated working preferences, not a verified identical template across all three films. [Steve Hullfish's Tom Cross interview, 2016](https://www.provideocoalition.com/art-cut-tom-cross-ace-whiplash-joy-la-la-land/amp/).

**Jennifer Lame — Manchester by the Sea interview.** Her line comparisons run horizontally, with favored performances raised to higher tracks. She likes making them herself because handling the material helps her learn it. The workflow must allow the assistant to prepare coverage while the editor does the ranking. Automating both steps together could remove a valuable part of the editor's process. [Steve Hullfish's Jennifer Lame interview, 2016](https://www.provideocoalition.com/aotc-manchester/amp/).

**Joe Walker, Chris Voutsinas, and Mercédesz Czanka — Dune: Part Two.** Walker describes Czanka preparing roughly 30–40-second scene sections across setups, including weak takes, with overlap between sections and visible separation. He raises preferred picture moments and separately identifies preferred audio, then discusses the material with collaborators before they cut. This supplies a concrete assistant-to-editor-to-assistant handoff model. Preserve complete coverage, independent sound preferences, and the editor's stated intentions. [Steve Hullfish's Dune: Part Two interview, 2024](https://borisfx.com/blog/AOTC/art-of-the-cut-dune/).

Proposed review modes:

| Mode | Best initial use | Preparation | Editor contribution |
| --- | --- | --- | --- |
| Source markers | Scripted dialogue with manageable coverage | Scene/setup view and verified source notes | Mark moments without building another sequence |
| Full stringout | Discovery, unfamiliar footage, visual exploration | Complete ordered ranges and navigation markers | Watch, skim, annotate, and find unexpected material |
| Line comparison | Repeated dialogue, alternate readings, improvisation | Verified comparable lines with surrounding context | Compare delivery and choose picture/audio independently |
| Beat sections | Long takes, ensemble scenes, action coverage | Overlapping sections and complete setup references | Identify essential moments and brief a collaborator |

These are suggested defaults. Let a scene change modes without losing notes or creating conflicting source identities. A selection rank is a person's opinion at a particular revision, not an intrinsic property of the footage.

### Script scenes, filmed takes, and thematic collections are different

**Oppenheimer — Jennifer Lame, Mike Fay, Nick Ellsberg, and Tom Foligno.** The team describes footage slated as one scene that covers several script scenes, requiring scene-specific references and explanatory notes. Abstract imagery also had category collections. The published Reel 6 legend separates native-format picture from 2.20 extractions. Visual inspection confirms layered picture treatments, extensive dialogue edits, and long audio returns; the written legend supplies their intended format roles. [Team interview and Reel 6 legend, 2023](https://borisfx.com/blog/aotc/art-of-the-cut-oppenheimer/); [original Reel 6 image](https://21305637.fs1.hubspotusercontent-na1.net/hubfs/21305637/AOTC/Oppenheimer/GADGET_R6.png).

Proposed schema must distinguish:

```text
MediaSource          original asset identity and metadata
SourceRange          start/end and timebase on that source
ScriptScene          scene identity within a particular script revision
CoverageReference    source range linked to one or more script scenes/beats
Collection           optional theme, subject, action, setup, or location view
Selection            reviewer, rank, reason, picture/audio preference
SequenceOccurrence   actual placement in an identified sequence revision
```

For example, one long take may supply ranges for scenes 120, 125, and 130 while also appearing in a character-reaction collection. That does not mean three copies of the physical media are needed. A project item's bin parent is storage organization; editorial membership can be many-to-many in the planning index. Verify how references map into Premiere before promising a native bin representation.

### Assistant timelines need named operational states

**Barbie — Nick Houy and first assistant Nick Ramirez, with Maya Rivera and Abdul Ndadi.** The published Reel 1 breakdown distinguishes working picture, alternative/turned-over/active/rough VFX, tracking, titles, change notes, and final color. Rough VFX could be disabled for screenings. The team retained eight reels after considering the sound department's cost of rebalancing. They also discuss separate creative experiments. The Reel 1 image was visually inspected; its labeled tracks support the published account. [Team interview and track legend, 2023](https://borisfx.com/blog/aotc/art-of-the-cut-barbie/); [original Reel 1 image](https://21305637.fs1.hubspotusercontent-na1.net/hubfs/21305637/AOTC/BARBIE/R1.png).

The proposed product should distinguish these independent facts:

| Field | Example values | Why it is separate |
| --- | --- | --- |
| Creative status | experiment, candidate, accepted, superseded | Accepted creative work may still be technically incomplete |
| Viewing profile | editorial, screening, clean reference, format-specific | A review configuration is not the cut itself |
| Department handoff | pending, prepared, sent, acknowledged, reconciled | Sending a file does not prove successful receipt or conform |
| Technical readiness | unchecked, failed, passed, unsupported | A technical pass is not creative approval |

Do not encode all of these in one color or one linear status. Capture which exact shot version and cut revision were acknowledged by which department. Preserve the before/after record when a viewing profile changes.

### Coverage checks and audience understanding require different reports

**Parasite — Yang Jinmo and on-set editor Meeyeon Han.** Yang describes Han checking whether the footage could assemble the intended sequence, followed by his own dissection and re-edit. He also describes having to manipulate shots when needed coverage was unavailable. This separates a production coverage check from the final editorial judgment. [Edgar Burcksen's ACE interview, March 29, 2020](https://editfestglobal.com/global-southkorea/).

**Killers of the Flower Moon — Thelma Schoonmaker.** She describes receiving Scorsese's daily script-supervisor notes, discussing dailies together, and taking her own careful notes before assembly. Preserve the origins of notes: director's shooting intent, script report, editor's first impression, and later screening response should remain distinguishable. [Post Magazine interview, 2023](https://www.postmagazine.com/Press-Center/Daily-News/2023/-I-Killers-of-the-Flower-Moon-I-Editor-Thelma-Sc.aspx).

**Conclave — Nick Emerson.** Emerson describes testing holds by a few frames and building around a key performance moment. His account of the voting sequences emphasizes distinct intended shots rather than indiscriminate reuse. Add a review question about what changes in each repeated scene and whether a reaction belongs to the intended dramatic context. [Filmmaker Magazine interview, Winter 2025](https://filmmakermagazine.com/128280-interview-nick-emerson-editor-conclave/).

**Free Solo — Bob Eisenhardt.** Screenings revealed gaps in audience understanding of the goal and the climb's stages. He describes the second act providing the knowledge needed to follow the final climb. This motivates a setup/payoff review: after removing an explanation, check every later scene that depends on it. This is an editorial aid, not automated proof of comprehension. [Oliver Peters's interview, August 10, 2019](https://digitalfilms.wordpress.com/2019/08/10/).

**Sound of Metal — Mikkel E. G. Nielsen.** Nielsen describes the opportunity to revisit picture after extensive sound work and screenings. The practical implication is that a nominal lock can be followed by another approved revision. Preserve old handoffs and explicitly issue changes when that happens. [Steve Hullfish interview, April 23, 2021](https://www.provideocoalition.com/art-of-the-cut-with-mikkel-e-g-nielsen-on-editing-sound-of-metal/).

### Premiere-specific findings from current Adobe documentation

Adobe documents saved Freeform View layouts. This provides a native manual route for visual organization; it does not establish an MCP API for positioning thumbnails. Start with a layout specification or companion contact sheet if the connected host lacks that capability. [Adobe Freeform layouts, updated January 7, 2026](https://helpx.adobe.com/premiere/desktop/get-started/customize-the-project-panel/create-layouts-in-freeform-view-in-project-panel.html).

Adobe's Simplify Sequence creates a copy and can flatten multicamera clips, close vertical video gaps, and remove selected elements. Flattened multicamera clips become non-switchable. Any future cleanup workflow should therefore target a deliberate derived sequence, preserve role/status metadata elsewhere, and verify the rendered result. [Adobe Simplify Sequence, updated August 18, 2026](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/simplify-sequence.html).

Adobe's current AAF documentation says merged clips are unsupported; Windows embedded AAF exports above 2 GB fail; separate audio preserves more metadata; and Broadcast Wave can carry iXML. Export settings must match the receiving application, including channelization, effects rendering, and handles. These become intake and turnover preflight questions, not a universal export preset. [Adobe AAF export, updated August 18, 2026](https://helpx.adobe.com/premiere/desktop/render-and-export/export-files/export-aaf-files.html).

The ScreenSkills editorial-trainee checklist describes metadata/report reconciliation, sync checks, MOS/wildtrack identification, and scene preparation according to editor preferences. Use it as an occupational cross-check rather than proof of a particular film's practice. The separate first-assistant PDF was not successfully retrieved. [ScreenSkills trainee checklist](https://www.screenskills.com/media/fj4lptiw/editorial-trainee-skills-checklist.pdf).

## Revised implementation priorities

This ordering supersedes the earlier implementation table where they differ. These are proposed additions; this research pass did not validate new host APIs.

| Priority | Work package | Concrete acceptance example |
| --- | --- | --- |
| P0 | Editorial profile and source/scene relationship model | A single take legitimately covers three script scenes without duplicate physical media or overwritten slate data |
| P0 | Selectable footage-review plans | The same coverage index produces a marker plan, full stringout, line comparison, or beat-section plan without losing source anchors |
| P0 | Human selects and collaboration brief | Picture and audio preferences remain independent; a collaborator receives the editor's required moments and can submit an alternate |
| P1 | Versioned notes and downstream change report | Moving a scene identifies affected reviews, sound/VFX handoffs, and reel membership; uncertain mappings are flagged |
| P1 | Viewing profiles and output preflight | An export intended for screening cannot silently inherit a diagnostic overlay or unreviewed viewing configuration |
| P1 | Department-specific turnover preparation | Required channels, handles, format, effects treatment, file limits, and reference are recorded and checked against a receiving specification |
| P2 | VFX replacement and returned-conform comparison | A new version is checked against its accepted predecessor and the exact cut supplied to the department |
| P2 | Story cards and visual setup board | Cards can reference scene fragments and dependencies without treating a UI rearrangement as an approved timeline edit |

Extend the existing planning/context layer before adding host commands. Avoid introducing a large collection of near-duplicate tools when one evidence model and several workflow prompts can express the difference.

### Additional pilot cases

1. One slate covering several scripted scenes, plus a changed script revision.
2. An alternate audio reading paired with a different picture take; preserve both identities and the intended sync relationship.
3. Overlapping beat sections where duplicated review context is intentional, but duplicate final placements are not.
4. A preferred take later rejected: the older ranking remains visible without controlling the new cut.
5. A picture change after sound turnover that moves a reel boundary and invalidates several notes.
6. A rough VFX version appropriate for editorial review but excluded from a specified screening profile.
7. A mixed-aspect-ratio sequence with separately reviewed framing configurations.
8. An AAF preflight with merged clips and a large embedded-audio estimate; require an explicit compatible preparation route.
9. A proposed deletion of a setup that leaves a later payoff unexplained; surface the dependency for editor review.
10. A collaborator's creative experiment submitted against an older cut; preserve it and report the comparison limitations.

### Research coverage and stopping point

The expanded pass adds direct interviews with editors and assistant teams, two visually inspected timeline images, a professional-association interview, documentary counterexamples, and current Adobe documentation. Film practices support workflow design; Adobe pages support native application behavior; neither proves our MCP can automate the workflow.

Searches focused on concrete organization, selects, and turnover claims. Follow-up reads resolved three material weaknesses in the first plan: a single review format, exclusive scene assignment, and overly simple handoff status. Exact private AE project templates, receiving-facility specifications, and host automation feasibility remain unknown. Further general interviews are less valuable now than testing the proposed profiles with a working editor and assistant using representative footage.
