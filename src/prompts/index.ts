/**
 * Workflow prompts.
 *
 * 269 tools is an API, not an assistant. An agent handed a flat list of 269 names has to
 * rediscover, every session, that you import before you edit, that effect names must match
 * this machine exactly, and that a node_id goes stale the moment the timeline shifts under
 * it. These encode the running order so it doesn't have to.
 *
 * Each prompt is deliberately opinionated about sequencing and about verification — the
 * failure mode we care most about is an agent that believes an edit landed when it didn't.
 */

export interface PromptArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDef {
  name: string;
  description: string;
  arguments: PromptArg[];
  build: (args: Record<string, string>) => string;
}

/** Prepended to every workflow. The rules that cause the most silent damage when ignored. */
const GROUND_RULES = `Before you start, read the premiere://state resource. It gives you the app version,
the open project, the active sequence and the playhead in one shot, and costs no tool call.

Rules that will bite you if you skip them:

- Node IDs go stale. Any edit that shifts the timeline (insert, ripple delete, trim) invalidates
  the node_ids you are holding. Re-query the sequence after structural edits rather than reusing
  IDs from before them.
- Effect and transition names must match this machine exactly. Read premiere://effects/available
  and premiere://transitions/available. Do not guess "Gaussian Blur" and hope.
- Import media before you touch the timeline. The first clip in a new sequence sets its
  resolution and frame rate, so import and add deliberately, not incidentally.
- Check what a tool returned. A tool that reports an error has not done the thing. Do not
  proceed as though it has, and do not paper over it by trying a different tool that also fails.
- Save when you reach a stable point, not after every micro-edit.`;

/** Frame capture is how an agent sees. Flag it honestly rather than promising it works. */
const VISUAL_CHECK = `To check your work visually, capture_frame renders the frame under the playhead and returns it
as an image you can actually look at. Note: frame capture is currently unreliable on some
Premiere builds (see issue #9) — if it errors, fall back to reading the timeline structure and
say plainly that you could not verify visually, rather than assuming the edit looks right.`;

export const PROMPTS: PromptDef[] = [
  {
    name: "orient",
    description: "Start here. Survey the project and timeline before touching anything.",
    arguments: [],
    build: () => `${GROUND_RULES}

Orient yourself in the current Premiere project, then report back. Do not change anything.

1. Read premiere://bridge/health. If the bridge is down, stop and say so — nothing else will work.
2. Read premiere://state, premiere://project/items and premiere://sequence/active.
3. Summarize for me:
   - the project, and whether it has unsaved changes
   - what media is in it
   - what sequences exist, and which is active
   - what is on the active timeline: tracks, clips, durations, gaps
   - anything that looks wrong or unfinished

End with what you think this project is *for*, and what you would do next. Ask before acting.`,
  },

  {
    name: "assemble_rough_cut",
    description: "Build a rough cut on the timeline from footage in the project.",
    arguments: [
      { name: "goal", description: "What the cut is for (e.g. '60s product teaser', 'talking-head intro')", required: true },
      { name: "duration_seconds", description: "Target duration in seconds", required: false },
      { name: "sequence_name", description: "Sequence to build into. Creates one if omitted.", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Assemble a rough cut: **${a.goal}**${a.duration_seconds ? `\nTarget duration: about ${a.duration_seconds} seconds.` : ""}

1. Read premiere://project/items to see what footage you actually have. If there is nothing
   usable, stop and tell me — do not invent media or import placeholder files.
2. ${a.sequence_name
      ? `Use the sequence "${a.sequence_name}" (create it if it doesn't exist).`
      : "Create a sequence, or use the active one if it's empty and suitable."}
   Remember the first clip sets resolution and frame rate — start with your best-quality source.
3. Lay clips down in a defensible order and explain the order you chose. Use add_to_timeline
   for insert edits, overwrite_clip for 3-point edits.
4. Trim the obvious dead air. Leave real editorial judgement to me.
5. Re-query the sequence and report the actual result: clip count, real total duration, any gaps.

Report the duration you actually achieved, not the one you were aiming for. If you came in at
40 seconds against a 60-second target, say 40.

${VISUAL_CHECK}`,
  },

  {
    name: "color_grade",
    description: "Apply a Lumetri grade across clips and verify it landed.",
    arguments: [
      { name: "look", description: "The look you want (e.g. 'warm cinematic', 'cold and desaturated', 'punchy high contrast')", required: true },
      { name: "scope", description: "'all' clips, 'selected' clips, or a specific node_id", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Grade the timeline for this look: **${a.look}**
Scope: ${a.scope ?? "all video clips on the active sequence"}

1. Query the sequence for the clips in scope and their node_ids.
2. Use color_correct (which drives Lumetri) rather than setting effect properties by hand.
   Available controls: exposure, contrast, highlights, shadows, whites, blacks, temperature,
   tint, saturation.
3. Translate the look into actual values and tell me the numbers you chose and why. "Warm
   cinematic" is not a setting; +12 temperature and -8 saturation is.
4. Apply per clip, and check each result. color_correct returns both a \`changes\` map and an
   \`errors\` map — a control that appears in \`errors\` did NOT get set. Report those honestly
   instead of claiming the grade is done.
5. Keep it consistent across clips unless there's a reason not to.

${VISUAL_CHECK} A grade is exactly the kind of change worth looking at.`,
  },

  {
    name: "add_transitions",
    description: "Place transitions at cut points without mangling the cut.",
    arguments: [
      { name: "style", description: "e.g. 'subtle cross dissolves', 'dip to black between scenes'", required: true },
      { name: "duration_seconds", description: "Transition duration (default: 1.0)", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Add transitions: **${a.style}**
Duration: ${a.duration_seconds ?? "1.0"}s

1. Read premiere://transitions/available FIRST. On Premiere 2026 the transition registry can
   come back empty even though by-name lookup works, so if the list looks short, the standard
   names ("Cross Dissolve", "Dip to Black") are still worth trying.
2. Find the cut points in the active sequence.
3. Transitions need adjacent clips and enough handle to work with. A transition at a cut where
   the clips have no spare frames will fail or eat visible content — check before placing, and
   skip the ones that can't take it.
4. Restraint. A dissolve on every cut looks like a slideshow, not a film. Place them where the
   edit calls for one and say where you chose not to.
5. Report what was placed and what was skipped, with reasons.`,
  },

  {
    name: "clean_up_audio",
    description: "Level audio and remove dead air.",
    arguments: [
      { name: "target_db", description: "Target level in dB (default: -12 for dialogue)", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Clean up the audio on the active sequence. Target level: ${a.target_db ?? "-12"} dB.

1. List the audio clips and their current levels.
2. Set levels toward the target with set_audio_level. Note that Premiere stores Level as an
   amplitude ratio, not dB — the tools handle the conversion, so pass dB and don't pre-convert.
3. Where a clip needs a ramp rather than a flat level, use add_audio_keyframes.
4. Find obvious dead air and long silences and tell me where they are, with timecodes. Do not
   cut them out unless I say so — removing audio is destructive and my sense of pacing is
   probably better than yours here.
5. Report the before and after level of every clip you touched.

Premiere has no scriptable silence detection, so "find the silences" means reading the timeline
structure, not analysing the waveform. Be honest about that limit.`,
  },

  {
    name: "add_titles",
    description: "Add text to the timeline, with a clear-eyed view of what the API can't do.",
    arguments: [
      { name: "text", description: "The text to display", required: true },
      { name: "start_seconds", description: "When it appears (default: 0)", required: false },
      { name: "duration_seconds", description: "How long it stays (default: 5)", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Add this text to the sequence: **${a.text}**
Start: ${a.start_seconds ?? "0"}s · Duration: ${a.duration_seconds ?? "5"}s

Read this before you start, because it will save us both time:

**Premiere's ExtendScript API does not expose Essential Graphics title creation.** You cannot
create a freeform styled title from a script. What you actually have:

- \`add_text_overlay\` routes through the Captions/Subtitle API. The text will appear on a caption
  track at the platform-default subtitle position. You cannot control font, size, colour, or
  placement. For a lower-third or a caption, this is fine.
- For a real designed title, the honest path is a pre-made MOGRT (\`import_mogrt\`), or rendering
  a PNG externally and importing it as media.

So: use add_text_overlay if a subtitle is what's wanted. If I asked for something that implies
design — a title card, a lower third with styling, anything with a font choice — **tell me the
API can't do it** and offer the MOGRT or PNG route. Do not silently produce a subtitle and call
it a title.`,
  },

  {
    name: "export",
    description: "Export the sequence with a preset that actually exists on this machine.",
    arguments: [
      { name: "output_path", description: "Full output file path", required: true },
      { name: "target", description: "Where it's going (e.g. 'YouTube 1080p', 'client review', 'Instagram')", required: false },
    ],
    build: (a) => `${GROUND_RULES}

Export the active sequence to: **${a.output_path}**${a.target ? `\nIntended for: ${a.target}` : ""}

1. Read premiere://export/presets. This lists the .epr presets actually installed here, each with
   its path. Do not guess a preset path — the presets that exist vary by machine and by Media
   Encoder version.
2. Pick one that fits the target and tell me which and why. If nothing fits, say so rather than
   silently falling back to something inappropriate.
3. Sanity-check first: does the sequence have content, is the work area what you expect, is the
   output directory writable?
4. Call export_sequence with the chosen preset path.
5. Export is asynchronous — Media Encoder renders in the background. \`queued: true\` means it was
   handed to AME, **not** that a file exists. Say "queued for export", and if I need confirmation
   it finished, check that the output file is actually on disk.`,
  },

  {
    name: "diagnose",
    description: "Work out why the bridge or a tool is failing.",
    arguments: [
      { name: "symptom", description: "What went wrong", required: false },
    ],
    build: (a) => `${GROUND_RULES.split("\n\n")[0]}

Diagnose the MCP bridge.${a.symptom ? `\n\nReported symptom: **${a.symptom}**` : ""}

Work down this list and report what you find at each step. Known failure modes, in the order
they actually happen:

1. **Bridge dead.** Read premiere://bridge/health (ping). No response means Premiere isn't
   running, or the MCP Bridge panel isn't open, or it isn't started. That's the answer ~80% of
   the time — check it before anything clever.

2. **Every tool returns null / "data": null.** This was the big one. It means the CEP panel is
   running the old CSInterface.js that drops the evalScript callback. Fixed in 1.1.2 — check the
   installed version. If patching a live install: closing and reopening the panel is required, a
   DevTools reload is NOT enough, because the old page's poller survives and keeps eating command
   files with the broken shim.

3. **"Cannot read properties of undefined (reading 'existsSync')".** The panel has no Node.
   \`--enable-nodejs\` is missing from CSXS/manifest.xml. Reinstall the CEP plugin.

4. **Panel won't load at all (Windows).** \`Signature verification failed\` in the CEP log. Set
   PlayerDebugMode=1 under HKCU\\SOFTWARE\\Adobe\\CSXS.*, or sign the extension.

5. **One specific tool fails.** Use execute_extendscript to probe the object directly, and
   inspect_dom_object to enumerate what methods actually exist on this build. Several tools have
   historically called methods that don't exist at all — if a method is missing from the object,
   that's a bug in this project, not a user error. Report it as one.

Report what you found, what you ruled out, and what you'd do next.`,
  },
];

export function getPrompt(name: string): PromptDef | undefined {
  return PROMPTS.find((p) => p.name === name);
}
