# Premiere Pro MCP Server — API Research & Capability Map

## Sources Researched

Film editor and assistant-editor workflow research is implemented as the local
`inspect_film_editorial_workflow` coverage/handoff packet tool. See
[usage and execution boundaries](docs/film-editorial-workflows.md) and
[research PR #476](https://github.com/leancoderkavy/premiere-pro-mcp/pull/476).
The packet verifies captured identities and revisions; it does not establish
live host timing, creative acceptance, vendor acknowledgement, or export success.

1. **ExtendScript Scripting Guide** (ppro-scripting.docsforadobe.dev) — Complete official reference
2. **QE DOM API** (vakago-tools.com, community.adobe.com) — Undocumented internal API via `app.enableQE()`
3. **UXP API Reference** (developer.adobe.com/premiere-pro/uxp/) — Modern API (v25.6+), action-based
4. **Adobe CEP Samples** (github.com/Adobe-CEP/Samples/PProPanel) — Official sample ExtendScript
5. **adb-mcp** (github.com/mikechambers/adb-mcp) — UXP-based MCP for Premiere (Python + proxy)
6. **hetpatel-11/Adobe_Premiere_Pro_MCP** — CEP-based MCP (same architecture as ours)

### Adobe AI editorial workflow boundary (2026-08-21)

Adobe's current Premiere AI Assistant documentation describes a beta, in-product
assistant that can organize Project-panel assets, work with transcripts and
markers, and help construct stringouts or first cuts. It does not document a
public CEP, UXP, REST, or MCP invocation API. The Generative Media Tool is also
beta and requires in-product access, service availability, and generative
credits; it is not wired to this server.

Accordingly, this repository exposes only local, revision-aware planning and
preview artifacts for editorial workflows. Applying any recommendation remains
an explicit call to a supported, separately authorized Premiere tool, and
generation, transcription, translation, cloud upload, and paid-provider use
remain outside this implementation.

Primary references:

- Adobe Premiere AI Assistant FAQ — https://helpx.adobe.com/premiere/desktop/premiere-ai-assistant/assistant-faq.html
- Adobe Premiere UXP Transcript API — https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/transcript/
- Adobe Premiere UXP SequenceEditor API — https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
- Adobe Premiere UXP Hybrid Plugins guide — https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/

---

## Historical Repository Snapshot (2026-07-20)

This is a dated research snapshot, not the source of truth for current releases or
tool counts. Use `README.md` and `CHANGELOG.md` for current product and release
information.

- **Release candidate:** `1.2.0` is integrated on `main`; `package.json`, `package-lock.json`, and
  both CEP extension entries in `cep-plugin/CSXS/manifest.xml` are version-aligned.
- **npm status:** `1.1.7` is not yet published. The registry publish was attempted after the GitHub
  push and stopped at npm's required one-time-password challenge; the package remains at `1.1.6`
  on npm until an authenticated publish completes.
- **MCP surface:** 268 runtime-registered tools across 29 modules, 3 resources, and 4 prompts.
  Capability profiles fail closed for raw scripting, and compound edit plans support preview-bound
  confirmation and correlated audit events.
- **UXP preview:** `uxp-plugin/` provides a versioned WebSocket protocol, capability discovery,
  state events, and verified frame export. Live Premiere and OS-specific loopback validation remain
  required before it can replace CEP in production.
- **CEP bridge:** The operational workflow is unchanged, but the visible panel now has a compact
  Premiere-oriented dark interface, clearer connection state, responsive controls, an improved
  bridge-directory field, and a larger live activity monitor. Accessibility work includes labels,
  focus states, live regions, and reduced-motion handling.
- **Website:** The redesigned landing page and its SEO metadata, manifest, dynamic `robots.txt`,
  and dynamic sitemap are merged into `main`.
- **Validation:** The root TypeScript build and all 333 automated tests pass. Landing-page lint
  passes, and Next.js compiles and generates all seven static pages. On this OneDrive checkout,
  the final export cleanup repeatedly reports `EBUSY` while removing `landing/out`; this is an
  environment/filesystem lock after page generation, not a source compilation failure.

### Release completion gate

Publish `premiere-pro-mcp@1.2.0` from `main` with a current npm authenticator OTP, then verify both
`npm view premiere-pro-mcp version` and the `latest` dist-tag resolve to `1.2.0`.

---

## Complete API Surface (ExtendScript + QE DOM)

### Application Object (`app`)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `app.enableQE()` | Enables QE DOM | ✅ |
| `app.project` | Active project | ✅ |
| `app.newProject(path)` | Create new project | ❌ **MISSING** |
| `app.openDocument(path)` | Open project | ✅ |
| `app.openFCPXML()` | Import FCP XML | ❌ |
| `app.quit()` | Quit Premiere | ❌ (dangerous) |
| `app.getEnableProxies()` | Check proxy state | ❌ |
| `app.setEnableProxies()` | Toggle proxies | ✅ (in manage_proxies) |
| `app.getWorkspaces()` | List workspaces | ✅ |
| `app.setWorkspace(name)` | Switch workspace | ✅ |
| `app.setScratchDiskPath(type, path)` | Set scratch disk | ✅ |
| `app.sourceMonitor` | Source monitor control | ✅ |
| `app.encoder` | AME encoder | ✅ |
| `app.properties` | Persistent properties | ❌ |
| `app.bind(eventName, fn)` | Event binding | N/A |
| `app.getProjectViewIDs()` | Multi-project support | ❌ |
| `app.getCurrentProjectViewSelection()` | Current selection | ❌ |

### Project Object (`app.project`)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `project.save()` | Save | ✅ |
| `project.saveAs(path)` | Save as | ✅ |
| `project.closeDocument(save, prompt)` | Close project | ❌ **MISSING** |
| `project.createNewSequence(name, id)` | Create sequence | ✅ |
| `project.createNewSequenceFromClips(name, items, bin)` | Sequence from clips | ✅ |
| `project.deleteSequence(seq)` | Delete sequence | ✅ |
| `project.importFiles(paths, suppressUI, targetBin, asNumbered)` | Import files | ✅ |
| `project.importAEComps(path, compNames, targetBin)` | Import AE comps | ✅ |
| `project.importAllAEComps(path, targetBin)` | Import all AE comps | ✅ |
| `project.importSequences(project, seqIDs)` | Import sequences from other project | ✅ |
| `project.exportAAF(...)` | Export AAF (14 params!) | ⚠️ Simplified |
| `project.exportFinalCutProXML(path, suppressUI)` | Export FCP XML | ✅ |
| `project.exportOMF(...)` | Export OMF | ✅ |
| `project.exportTimeline(preset)` | Export via preset | ❌ |
| `project.consolidateDuplicates()` | Consolidate | ✅ |
| `project.newBarsAndTone(w, h, base, name)` | Create bars & tone | ✅ |
| `project.newSequence(name, pathToPreset)` | New seq from preset | ❌ |
| `project.openSequence(seqID)` | Open/activate sequence | ✅ |
| `project.getInsertionBin()` | Current target bin | ✅ |
| `project.setEnableTranscodeOnIngest(enable)` | Ingest transcoding | ✅ |
| `project.getGraphicsWhiteLuminance()` | HDR setting | ✅ |
| `project.setGraphicsWhiteLuminance(val)` | HDR setting | ✅ |
| `project.getProjectPanelMetadata()` | Panel metadata columns | ✅ |
| `project.setProjectPanelMetadata(json)` | Set panel metadata | ✅ |
| `project.addPropertyToProjectMetadataSchema(name, label, type)` | Add custom metadata field | ✅ |

### Sequence Object
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `seq.insertClip(item, time, vTrack, aTrack)` | Insert (ripple) clip | ✅ |
| `seq.overwriteClip(item, time, vTrack, aTrack)` | Overwrite clip | ✅ |
| `seq.importMGT(path, time, vOff, aOff)` | Import MOGRT | ✅ |
| `seq.importMGTFromLibrary(lib, name, time, v, a)` | MOGRT from CC Library | ✅ |
| `seq.clone()` | Duplicate sequence | ✅ |
| `seq.close()` | Close sequence tab | ✅ |
| `seq.createSubsequence(ignoreMapping)` | Create subsequence | ✅ |
| `seq.createCaptionTrack(item, startTime, captionFormat)` | Captions | ✅ |
| `seq.autoReframeSequence(num, den, preset, name, nested)` | Auto reframe | ✅ |
| `seq.attachCustomProperty(id, value)` | Custom FCP XML props | ✅ |
| `seq.getSettings()` | Get all settings | ✅ |
| `seq.setSettings(settings)` | Modify settings | ✅ |
| `seq.getSelection()` | Selected clips array | ✅ |
| `seq.getPlayerPosition()` | Playhead position | ✅ |
| `seq.setPlayerPosition(ticks)` | Move playhead | ✅ |
| `seq.getInPoint()` / `getOutPoint()` | Sequence I/O points | ✅ |
| `seq.setInPoint()` / `setOutPoint()` | Set I/O points | ✅ |
| `seq.getWorkAreaInPoint()` / `OutPoint()` | Work area | ✅ |
| `seq.setWorkAreaInPoint()` / `OutPoint()` | Set work area | ✅ |
| `seq.linkSelection()` | Link selected A/V | ✅ |
| `seq.unlinkSelection()` | Unlink selected A/V | ✅ |
| `seq.exportAsMediaDirect(path, preset, workArea)` | Direct export | ✅ |
| `seq.exportAsProject(path)` | Export as .prproj | ✅ |
| `seq.exportAsFinalCutProXML(path)` | FCP XML | ✅ |
| `seq.getExportFileExtension(preset)` | Get extension for preset | ✅ |
| `seq.isDoneAnalyzingForVideoEffects()` | Check analysis status | ❌ |
| `seq.isWorkAreaEnabled()` | Check work area bar | ✅ |
| `seq.setZeroPoint(ticks)` | Set start time code | ✅ |
| `seq.performSceneEditDetectionOnSelection()` | Scene detect | ✅ |

### Track Object
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `track.insertClip(item, time, vTrack, aTrack)` | Insert clip | ✅ |
| `track.overwriteClip(item, time)` | Overwrite clip | ❌ **MISSING** |
| `track.isMuted()` | Check mute | ❌ |
| `track.setMute(muted)` | Set mute | ✅ |
| `track.clips` | TrackItemCollection | ✅ |
| `track.transitions` | Transitions on track | ❌ (read) |

### TrackItem Object
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `clip.name` | Clip name | ✅ |
| `clip.nodeId` | Unique ID | ✅ |
| `clip.start` / `end` | Timeline position | ✅ |
| `clip.inPoint` / `outPoint` | Source I/O | ✅ |
| `clip.duration` | Duration | ✅ |
| `clip.components` | Effect components | ✅ |
| `clip.projectItem` | Source project item | ✅ |
| `clip.getSpeed()` | Speed multiplier | ✅ |
| `clip.isSpeedReversed()` | Is reversed? | ✅ |
| `clip.isAdjustmentLayer()` | Is adjustment layer? | ✅ |
| `clip.isSelected()` | Selection state | ✅ |
| `clip.setSelected(state, updateUI)` | Set selection | ✅ |
| `clip.remove(inRipple, inAlignToVideo)` | Remove clip (the `inRipple` flag is accepted and ignored) | ✅ |
| `clip.move(newInPoint)` | Move clip | ✅ |
| `clip.disabled` | Enable/disable | ✅ |
| `clip.getMGTComponent()` | MOGRT params | ✅ |
| `clip.getMatchName()` | Match name | ❌ |

### ProjectItem Object
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `item.name` / `nodeId` / `type` / `treePath` | Identity | ✅ |
| `item.children` | Children (for bins) | ✅ |
| `item.createBin(name)` | Create bin | ✅ |
| `item.createSmartBin(name, query)` | Smart bin | ✅ |
| `item.createSubClip(name, start, end, hard, audio, video)` | Subclip | ✅ |
| `item.deleteBin()` | Delete bin | ✅ |
| `item.moveBin(destBin)` | Move to bin | ✅ |
| `item.renameBin(name)` | Rename bin | ✅ |
| `item.select()` | Select in project panel | ✅ |
| `item.setScaleToFrameSize()` | Scale to frame | ✅ |
| `item.setStartTime(ticks)` | Set start time | ✅ |
| `item.setOverrideFrameRate(fps)` | Override FPS | ✅ |
| `item.setOverridePixelAspectRatio(n, d)` | Override PAR | ✅ |
| `item.setOffline()` | Set offline | ✅ |
| `item.refreshMedia()` | Refresh | ✅ |
| `item.changeMediaPath(path, overrideChecks)` | Relink | ✅ |
| `item.attachProxy(path, isHiRes)` | Proxy | ✅ |
| `item.hasProxy()` | Has proxy? | ✅ |
| `item.canProxy()` | Can proxy? | ❌ |
| `item.isOffline()` | Offline? | ✅ |
| `item.isSequence()` | Is sequence? | ❌ |
| `item.isMergedClip()` | Merged? | ❌ |
| `item.isMulticamClip()` | Multicam? | ❌ |
| `item.findItemsMatchingMediaPath(path)` | Find by path | ✅ |
| `item.getColorLabel()` / `setColorLabel(idx)` | Color label | ✅ |
| `item.getFootageInterpretation()` / `setFootageInterpretation()` | Footage interp | ✅ |
| `item.getProjectMetadata()` / `setProjectMetadata()` | XMP metadata | ✅ |
| `item.getXMPMetadata()` / `setXMPMetadata()` | Raw XMP | ✅ |
| `item.videoComponents()` | Video components on source | ❌ |
| `item.getColorSpace()` | Color space | ✅ |
| `item.getOriginalColorSpace()` | Original color space | ❌ |
| `item.getEmbeddedLUTID()` | Embedded LUT | ❌ |
| `item.getInputLUTID()` | Input LUT | ❌ |
| `item.getInPoint()` / `getOutPoint()` | Source I/O | ❌ |
| `item.setInPoint()` / `setOutPoint()` | Set source I/O | ❌ |
| `item.clearInPoint()` / `clearOutPoint()` | Clear source I/O | ❌ |

### ComponentParam Object (Keyframes & Effect Properties)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `param.getValue()` | Get current value | ✅ |
| `param.setValue(val, updateUI)` | Set value | ✅ |
| `param.getValueAtKey(time)` | Value at keyframe | ❌ |
| `param.getValueAtTime(time)` | Interpolated value at time | ✅ (in keyframes.ts) |
| `param.setValueAtKey(time, val, updateUI)` | Set at keyframe | ✅ |
| `param.addKey(time)` | Add keyframe | ✅ |
| `param.removeKey(time)` | Remove keyframe | ✅ |
| `param.removeKeyRange(start, end)` | Remove keyframe range | ✅ |
| `param.getKeys()` | All keyframe times | ✅ |
| `param.findNearestKey(time, threshold)` | Find nearest | ❌ |
| `param.findNextKey(time)` | Find next | ❌ |
| `param.findPreviousKey(time)` | Find previous | ❌ |
| `param.areKeyframesSupported()` | Supports keyframes? | ❌ |
| `param.isTimeVarying()` | Has keyframes? | ❌ |
| `param.setTimeVarying(bool)` | Enable keyframes | ✅ |
| `param.setInterpolationTypeAtKey(time, type, updateUI)` | Interp type | ✅ |
| `param.getColorValue()` | Color value | ❌ |
| `param.setColorValue(a, r, g, b, updateUI)` | Set color | ✅ |
| `param.displayName` | Property name | ✅ |

### Encoder Object (`app.encoder`)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `encoder.encodeSequence(seq, path, preset, workArea, removeOnCompletion)` | Queue encode | ✅ |
| `encoder.encodeProjectItem(item, path, preset, workArea, removeOnCompletion)` | Encode item | ✅ |
| `encoder.encodeFile(path, outputPath, preset, removeOnCompletion, startTime, stopTime)` | Encode file | ✅ |
| `encoder.launchEncoder()` | Launch AME | ✅ |
| `encoder.startBatch()` | Start render queue | ✅ |
| `encoder.setEmbeddedXMPEnabled(enable)` | XMP in output | ❌ |
| `encoder.setSidecarXMPEnabled(enable)` | Sidecar XMP | ❌ |

### Source Monitor (`app.sourceMonitor`)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `sourceMonitor.openProjectItem(item)` | Open in source | ✅ |
| `sourceMonitor.openFilePath(path)` | Open file in source | ✅ |
| `sourceMonitor.closeClip()` | Close current | ✅ |
| `sourceMonitor.closeAllClips()` | Close all | ✅ |
| `sourceMonitor.play(speed)` | Play | ✅ |
| `sourceMonitor.getPosition()` | CTI position | ✅ |
| `sourceMonitor.getProjectItem()` | Currently loaded item | ✅ |

### Project Manager (`app.projectManager`)
| Attribute | Description | Implemented? |
|-----------|-------------|:---:|
| All 14+ attributes for project consolidation/trimming | Copy, transfer, transcode | ✅ |

---

### CEP panel runtime (`__adobe_cep__`, not ExtendScript)

A few things exist only in the CEP panel's own runtime, never in ExtendScript, so the connector answers them itself (`cep-plugin/panel-commands.cjs`):

| Call | Used by | Notes |
|---|---|---|
| `getExtensions(JSON.stringify([]))` | `list_extensions`, `open_extension` preflight | JSON array of installed extensions: `id`, `name`, `windowType`, `isActive`, and more. Measured in Premiere 26.3 (2026-10-27): `isActive` stayed `false` both for a panel just opened with `requestOpenExtension` and for the running headless connector itself, so it does not indicate visibility. |
| `requestOpenExtension(id, params)` | `open_extension` | Works from the headless connector; no completion callback and no visibility getter, so the outcome is `committed_unverified` |
| `closeExtension()` | not exposed | Closes only the calling extension; CEP has no way to close another one |

## QE DOM (Undocumented but Critical)

**Must call `app.enableQE()` first.**

### QE Global (`qe`)
| Method | Description |
|--------|-------------|
| `qe.project` | QE project object |
| `qe.getSequencePresets()` | All sequence presets |
| `qe.newProject(path)` | New project |
| `qe.open(path, showUI)` | Open project |
| `qe.startPlayback()` | Play timeline |
| `qe.stopPlayback()` | Stop playback |
| `qe.stop()` | Stop |
| `qe.exit()` | Exit app |
| `qe.wait(ms)` | Wait |
| `qe.getModalWindowID()` | Modal check |
| `qe.executeConsoleCommand(cmd)` | Console command |

### QE Project (`qe.project`)
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `qe.project.getActiveSequence()` | QE active sequence | ✅ |
| `qe.project.getVideoEffectList()` | All video effects | ✅ |
| `qe.project.getVideoEffectByName(name)` | Get effect by name | ✅ |
| `qe.project.getAudioEffectList()` | All audio effects | ✅ |
| `qe.project.getAudioEffectByName(name)` | Get audio effect | ✅ |
| `qe.project.getVideoTransitionList()` | All video transitions | ✅ |
| `qe.project.getVideoTransitionByName(name)` | Get transition | ✅ |
| `qe.project.getAudioTransitionList()` | All audio transitions | ✅ |
| `qe.project.getAudioTransitionByName(name)` | Get audio transition | ✅ |
| `qe.project.undo()` | Undo | ✅ |
| `qe.project.newSequence(name, presetPath)` | New seq from preset | ❌ **MISSING** |
| `qe.project.importFiles(paths)` | Import | ❌ |
| `qe.project.importAEComps(path, compNames)` | AE comps | ❌ |

### QE Sequence
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `qeSeq.getVideoTrackAt(idx)` | Get video track | ✅ |
| `qeSeq.getAudioTrackAt(idx)` | Get audio track | ✅ |
| `qeSeq.addTracks(vNum, aNum, aMono, a5_1, aAdaptive)` | Add tracks | ✅ |
| `qeSeq.removeTracks(vIdx, aIdx, aMonoIdx, a5_1Idx)` | Remove tracks | ❌ |

### QE Track Item (Clip) — **THE MOST POWERFUL PART**
| Method | Description | Implemented? |
|--------|-------------|:---:|
| `qeClip.addVideoEffect(effect)` | Add video effect | ✅ |
| `qeClip.addAudioEffect(effect)` | Add audio effect | ✅ |
| `qeClip.addTransition(transition, ...)` | Add transition | ✅ |
| `qeClip.removeEffects()` | Remove ALL effects | ✅ |
| `qeClip.remove()` | Remove from timeline | ✅ |
| `qeClip.rippleDelete()` | Ripple delete | ⚠️ non-functional — see below |
| `qeClip.move(newTime)` | Move clip | ❌ |
| `qeClip.moveToTrack(trackIdx)` | Move to different track | ✅ |
| `qeClip.roll(newTime)` | Roll edit | ✅ |
| `qeClip.slide(offset)` | Slide edit | ✅ |
| `qeClip.slip(offset)` | Slip edit | ✅ |
| `qeClip.setSpeed(speed, ...)` | Set playback speed | ⛔ reflected but deliberately unused (#295/#299, #593) |
| `qeClip.setReverse(reverse)` | Reverse playback | ⛔ reflected but deliberately unused (#295/#299, #593) |
| `qeClip.setName(name)` | Rename clip | ✅ |
| `qeClip.setScaleToFrameSize()` | Scale to frame | ❌ |
| `qeClip.setFrameBlend(enable)` | Frame blending | ✅ |
| `qeClip.setTimeInterpolationType(type)` | Time interp (optical flow etc.) | ✅ |
| `qeClip.setAntiAliasQuality(quality)` | Anti-alias | ❌ |
| `qeClip.setStartPercent(pct)` | Transition start % | ❌ |
| `qeClip.setEndPercent(pct)` | Transition end % | ❌ |
| `qeClip.setStartPosition(pos)` | Start position | ❌ |
| `qeClip.setEndPosition(pos)` | End position | ❌ |
| `qeClip.setBorderColor(color)` | Border color | ❌ |
| `qeClip.setBorderWidth(width)` | Border width | ❌ |
| `qeClip.setMulticam(enable)` | Multicam | ❌ |
| `qeClip.setSwitchSources(enable)` | Switch sources | ❌ |
| `qeClip.canDoMulticam()` | Check multicam | ❌ |
| `qeClip.getClipPanComponent()` | Pan component | ❌ |
| `qeClip.getComponentAt(idx)` | Get component | ❌ |
| `qeClip.getProjectItem()` | Source item | ❌ |

---

### Ripple delete: both native routes are dead on 26.x (verified 26.3.2)

Measured, not inferred:

- **`qeClip.rippleDelete()` returns `false` and changes nothing.** Tested under four
  conditions — clip selected first, sync lock off on every track, targeting the last
  clip on a track, and targeting a gap (`Empty`) item. `false` every time.
- **`TrackItem.remove(true, false)` removes the clip and leaves the gap.** The
  `inRipple` flag is accepted and ignored.

So a ripple has to be implemented explicitly: remove the clip, then shift every later
clip earlier by the gap size. Two things make that non-trivial:

- **Sync-lock state is only readable through QE** (`qeTrack.isSyncLocked()`); the public
  DOM does not expose it. Without it there is no way to know which tracks Premiere
  itself would have rippled, and shifting only the clip's own track silently desyncs
  audio.
- **Clips must be shifted in ascending start order**, writing `start` before `end`.
  Premiere rejects a `start` write that would push `start` past the clip's current
  `end`, and writing `start` never carries `end` with it. Moving earlier, start-then-end
  keeps `start < end` at every intermediate step; the other order fails silently.

`ripple_delete` in `advanced.ts` implements this, pre-flighting every participating
track before mutating anything so that a clip straddling the ripple point, a partially
overlapping clip, or a locked participating track is refused with the timeline
untouched.

## Implementation Status — Priority List

**Total runtime-registered tools: 268 across 29 modules** (including safe edit plans)

### P0 — Critical ✅ ALL IMPLEMENTED
1. ~~**`create_project`**~~ — ❌ Intentionally skipped (requires UXP, not available via ExtendScript CEP)
2. ✅ **`create_sequence_from_clips`** — `project.createNewSequenceFromClips` (advanced.ts)
3. ✅ **`overwrite_clip`** — `seq.overwriteClip` (advanced.ts)
4. ✅ **`ripple_delete`** — QE DOM (advanced.ts)
5. ✅ **`close_gaps`** — QE DOM ripple delete approach (advanced.ts)
6. ✅ **`get_clip_speed`** — `clip.getSpeed()` + `isSpeedReversed()` (advanced.ts)
7. ⛔ **`set_clip_speed_qe`** — registered but always fails before mutation; no documented ExtendScript or UXP speed setter exists (#593). Use `set_clip_duration` (`TrackItem.end`) for timeline length.
8. ⛔ **`reverse_clip`** — registered but always fails before mutation; no documented direction setter exists.

### P1 — Important for full LLM control ✅ ALL IMPLEMENTED
9. ✅ **`link_selection` / `unlink_selection`** — (advanced.ts)
10. ✅ **`set_clip_selection`** — (selection.ts)
11. ✅ **`roll_edit` / `slide_edit` / `slip_edit`** — QE DOM (advanced.ts)
12. ✅ **`move_clip_to_track`** — QE DOM (advanced.ts)
13. ✅ **`remove_all_effects`** — QE DOM (advanced.ts)
14. ✅ **`set_blend_mode`** — (utility.ts)
15. ✅ **`set_color_value`** — `param.setColorValue()` (advanced.ts)
16. ✅ **`capture_frame`** — Export frame + return as base64 image (export.ts)
17. ✅ **`set_keyframe_interpolation`** — Linear/Bezier/Hold (keyframes.ts)
18. ✅ **`get_keyframes` / `remove_keyframe` / `remove_keyframe_range`** — Full CRUD (keyframes.ts)

### P2 — Nice-to-have ✅ ALL IMPLEMENTED
19. ✅ **`close_sequence`** — `seq.close()` (advanced.ts)
20. ✅ **`export_as_project`** — `seq.exportAsProject()` (advanced.ts)
21. ✅ **`create_bars_and_tone`** — `project.newBarsAndTone()` (project.ts)
22. ✅ **`open_in_source_monitor`** — (source-monitor.ts)
23. ✅ **`play_source_monitor`** — (playback.ts)
24. ✅ **`start_batch_encode`** — `encoder.startBatch()` (advanced.ts)
25. ✅ **`encode_project_item` / `encode_file`** — (export.ts)
26. ✅ **`import_ae_comps`** — (project.ts)
27. ✅ **`set_frame_blend`** — QE DOM (advanced.ts)
28. ✅ **`set_time_interpolation`** — Optical flow etc. (advanced.ts)
29. ✅ **`delete_bin` / `rename_bin`** — (advanced.ts)
30. ✅ **`create_smart_bin`** — (advanced.ts)
31. ✅ **`find_items_by_media_path`** — (advanced.ts)
32. ✅ **`add_custom_metadata_field`** — (advanced.ts)
33. ✅ **`set_zero_point`** — (advanced.ts)
34. ✅ **`scene_edit_detection`** — (utility.ts)
35. ✅ **`get/set_workspace`** — (workspace.ts)
36. ✅ **LLM instructions resource** — `config://premiere-instructions` + `config://extendscript-reference`

### Verified behaviour on Premiere Pro 25.2 and After Effects 25.1 (2026-09)

Found by running every registered tool live against real footage (a 121.6 s, 25 fps
event recap) and checking results independently — exported frames against the source
with SSIM, audio by transcription and EBU R128, EDL timecodes by hand, and saved
project files — rather than trusting tool readback. Each item is fixed in the tools and
covered by a fake-host test.

- **Undo is scriptable through QE.** `app.project.undo` does not exist, but
  `qe.project.undo()`/`redo()` work and `qe.project.undoStackIndex()` moves by exactly
  one per step, so undo can be verified. Most DOM property and marker writes add no
  undo entries; QE edits add several (a razor plus relink added 6–8).
- **Lift is `qeSeq.left()`.** `qeSeq.lift()` does not exist; `extract()` does.
- **Clip removal does not ripple.** `TrackItem.remove(true, …)` leaves the gap (as on
  26.x) and never takes the linked partner; ripple removals reuse the explicit
  sync-locked ripple from `ripple_delete`.
- **QE track items include empty gaps**, so QE lookups by DOM clip index hit the gap
  after any gap on the track; rename uses the writable `TrackItem.name` instead.
- **Tracks are removed with `qeSeq.removeVideoTrack(i)`/`removeAudioTrack(i)`**;
  `Sequence.deleteVideoTrackAt` does not exist.
- **Colour parameters** return `getValue()` as a packed 64-bit integer a JS double
  cannot hold; `getColorValue()` returns `[a, r, g, b]`.
- **`videoPixelAspectRatio` is read-only** and reads as `"1:1"`.
- **Auto Reframe keeps the source height** (9:16 of 1080p gives 607×1080); setting
  the requested frame size afterwards is honoured and Auto Reframe refits.
- **The work area cannot be set by script**; export ranges use
  `app.encoder.ENCODE_IN_TO_OUT` with sequence in/out.
- **AME folder codes decide the container.** Presets named "H264 …" in the
  `…_4D6F6F56` ("MooV") folder write QuickTime; the H.264 MP4 exporter is
  `…_48323634`. `seq.getExportFileExtension(preset)` reports the real extension.
- **`app.encoder.encodeFile`** takes `(input, output, preset, removeUponCompletion[,
  startTime, stopTime])`; an extra work-area argument throws "Illegal Parameter type".
- **Scratch disks** take `ScratchDiskType.*` constants (plain strings are ignored,
  `project.setScratchDiskPath` throws) and are only readable from the saved `.prproj`.
- **Project Manager options live on `app.projectManager.options`**, the destination
  must exist, `process()` returns 0 on success, and output lands in `Copied_<project>/`.
- **Multiple open projects:** `project.saveAs` opens the copy and closes the original;
  `openDocument` returns false for an already-open project, and `openSequence` on one
  of its sequences brings it to the front. `openFCPXML(xml, dir)` treats its second
  argument as a folder prefix.
- **`new Folder(path).exists` is true for files**; `Folder(path) instanceof Folder`
  (without `new`) tells them apart.
- **`export_as_fcp_xml` writes FCP7 `xmeml`**, with media as `<file><pathurl>`.
- **Scene edit detection** puts Segmentation markers on the source project item, not
  the sequence, duplicates them on every run, and blocks Premiere for the analysis.
- **After Effects:** `exportAsMotionGraphicsTemplate` stops on a modal warning when a
  text font is not from Adobe Fonts (suppressing dialogs cancels the export), and on
  success leaves its scripting objects invalid, so nothing may touch the comp after it;
  `RenderQueueItem` has no `index`.

### New modules added
- **workspace.ts** (2 tools) — get_workspaces, set_workspace
- **captions.ts** (1 tool) — create_caption_track
- **playback.ts** (4 tools) — play_timeline, stop_playback, play_source_monitor, get_source_monitor_position
- **project-manager.ts** (1 tool) — consolidate_and_transfer
- **health.ts** (1 tool) — ping
- **stock-titles.ts** (2 tools) — list_stock_titles, add_title (Premiere's bundled title templates with the text baked into a copy, since their text is not scriptable)

### Remaining unimplemented (low-value or risky)
- `app.newProject()` — Requires UXP or has severe limitations in ExtendScript
- `app.quit()` — Dangerous, intentionally excluded
- `app.openFCPXML()` — Use import_fcp_xml instead
- `track.overwriteClip()` — Covered by seq.overwriteClip
- `item.canProxy()`, `item.isSequence()`, `item.isMergedClip()`, `item.isMulticamClip()` — Minor read-only checks
- `param.findNearestKey()`, `param.findNextKey()`, `param.findPreviousKey()` — Minor keyframe navigation
- `qeClip.setAntiAliasQuality()`, `qeClip.setBorderColor/Width()`, `qeClip.setMulticam()` — Niche QE features
- `qeSeq.removeTracks()` — Risky operation

---

## Known Effect Match Names (for `appendVideoFilter` via QE)

From adb-mcp research:
- `AE.ADBE Black & White` — Black and white
- `AE.ADBE Gaussian Blur 2` — Gaussian blur (properties: `Blurriness`, `Blur Dimensions`)
- `AE.ADBE Tint` — Tint (properties: `Map Black To`, `Map White To`, `Amount to Tint`)
- `AE.ADBE Motion Blur` — Directional blur (properties: `Direction`, `Blur Length`)

### Valid Transition Names
**ADBE (built-in):**
- `ADBE Additive Dissolve`, `ADBE Cross Zoom`, `ADBE Cube Spin`, `ADBE Film Dissolve`
- `ADBE Flip Over`, `ADBE Gradient Wipe`, `ADBE Iris Cross`, `ADBE Iris Diamond`
- `ADBE Iris Round`, `ADBE Iris Square`, `ADBE Page Peel`, `ADBE Push`, `ADBE Slide`, `ADBE Wipe`

**AE.ADBE (After Effects):**
- `AE.ADBE Center Split`, `AE.ADBE Inset`, `AE.ADBE Cross Dissolve New`
- `AE.ADBE Dip To White`, `AE.ADBE Split`, `AE.ADBE Whip`
- `AE.ADBE Non-Additive Dissolve`, `AE.ADBE Dip To Black`
- `AE.ADBE Barn Doors`, `AE.ADBE MorphCut`

### Blend Modes
`NORMAL`, `DISSOLVE`, `DARKEN`, `MULTIPLY`, `COLORBURN`, `LINEARBURN`, `DARKERCOLOR`,
`LIGHTEN`, `SCREEN`, `COLORDODGE`, `LINEARDODGE`, `LIGHTERCOLOR`, `OVERLAY`, `SOFTLIGHT`,
`HARDLIGHT`, `VIVIDLIGHT`, `LINEARLIGHT`, `PINLIGHT`, `HARDMIX`, `DIFFERENCE`, `EXCLUSION`,
`SUBTRACT`, `DIVIDE`, `HUE`, `SATURATION`, `COLOR`, `LUMINOSITY`

### Interpolation Types
- `0` — KF_Interp_Mode_Linear
- `4` — KF_Interp_Mode_Hold
- `5` — KF_Interp_Mode_Bezier

---

## Architecture Insights from adb-mcp

Their MCP server includes a **resource** (`config://get_instructions`) that gives the LLM context about how to use Premiere effectively:
- "Add clips first, then effects, then transitions"
- "Keep transitions short (≤2 seconds)"
- "No gap between clips for transitions to work"
- "Video clips with higher track index overlap lower ones"
- "Images have default 5-second duration"
- "First clip determines sequence resolution"

This recommendation is implemented. Our server exposes `config://premiere-instructions` for editing
workflow guidance and `config://extendscript-reference` for the scripting surface. Both resources are
registered alongside the tool catalog in `src/server.ts`; version 1.2.0 also registers
`config://premiere-workflows` and four guided prompts.

## Public workflow research: Filmit (2026-10-04)

Public product research informed five independently implemented local review tools: dialogue candidates, quote paper edits, text changes, synchronization evidence, and owned-footage B-roll placements. Sources: https://filmit.io/jumpcut, https://filmit.io/roughcut, https://filmit.io/textpilot, https://filmit.io/sync, https://filmit.io/broll. Vendor implementation and compatibility claims were not tested. No vendor code, plugin binaries, presets, media or assets are incorporated. These tools accept captured evidence and produce bounded review results only; they do not implement local Whisper, waveform matching, visual inference, native text access or new host mutations.

## Filmcraft-inspired bounded contracts (2026-10-11)

See `docs/filmcraft-improvements.md` for the 52-item implementation ledger, source boundaries and supported workflow routes. This adaptation adds exact local time/edit algebra, replay/recovery protection, explicit delivery evidence and bounded interchange analysis; it does not replace Adobe codecs or claim unrun licensed-host coverage. Documented UXP OTIO import/export remains format-specific and runtime-probed. FCP 7 xmeml is distinct from modern FCPXML.

### After Effects round trip (2026-10-26)

Live on Premiere Pro 26.5.2 and After Effects 26.5 (macOS), scratch projects only.
`importAEComps` creates a Dynamic Link item named `<comp>/<file>.aep` with codec
`DLYM`; changing the comp in AE shows up in Premiere without any Premiere call, but
`exportFramePNG` at a time it already rendered returns the cached frame. A comp whose
footage layer has `audioEnabled = false` imports as a video-only item (audio marks
0-0), so `Track.overwriteClip` through `replace_clip` places it without touching the
audio track. A footage layer with `startTime = -sourceIn` shows the clip's source In
at comp time 0; a frame exported from the swapped span matched the source frame at
the same source time. AE render templates are only readable from a render-queue
item (`RenderQueueItem.templates`, `OutputModule.templates`).

### Title style boundary (2026-10-23)

Local source review only; no application, network or rendering probe was run.
`stock-titles.ts` and `mogrt-text.ts` already read AE-authored MGT text controls
as JSON containing `textEditValue`; existing stock-title fixtures preserve
`fontName` and `fontSize`. These private keys are conditional template contracts,
not a general Premiere font API. The title style path modifies only one existing
top-level key and compares final raw JSON in Node. Missing, nested, duplicated,
animated or unreadable controls remain unverified. Stored font-name equality
does not establish installed fonts or rendered glyphs.

The existing `advanced.ts` color setter uses ComponentParam `setColorValue` /
`getColorValue` with ARGB channels in 0–255 and rejects animation. Title fill
uses that contract only for exactly one static exposed `Fill Color` control;
it does not invent a private Source Text color encoding. The existing
`script-builder.ts` Motion helper records normalized Motion Position (0.5,0.5
is the center); title position writes that intrinsic whole-graphic point and
compares both stored components. It does not move internal text anchors.

`mogrt-bake.ts` preserves Premiere-authored Source Text JSON, including opaque
style structures; it only has a tested text-baking contract. It is not extended
to guess font runs, fill encodings or alignment enums. Live font/fill styling
on those templates and every `align` request are refused before bake/import.
Tracking is unsupported. No CEP 26.5.2 compatibility or font-rendering claim
is established by these fake-host tests. Templates with suitable exposed
controls and matching fonts still require an operator-run scratch scenario,
save/reopen and rendered review. No undocumented fallback or external editor
is invoked.

## Track transition removal and structural edit boundaries

The recorded Premiere26.5.2 editing finding identifies TrackTransition.remove(false, false) as the working CEP removal shape; calling remove() without its two arguments throws. The removal tool uses that existing DOM surface without a QE fallback and checks the entire surviving span list. This is local fake-host coverage, pending native verification. Structural edits conservatively refuse transitions occupying an edited clip span or the participating ripple suffix, since no documented transition-follow-edge contract is established here. Stored span readback does not prove rendered appearance.
