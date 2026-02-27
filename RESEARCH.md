# Premiere Pro MCP Server — API Research & Capability Map

## Sources Researched

1. **ExtendScript Scripting Guide** (ppro-scripting.docsforadobe.dev) — Complete official reference
2. **QE DOM API** (vakago-tools.com, community.adobe.com) — Undocumented internal API via `app.enableQE()`
3. **UXP API Reference** (developer.adobe.com/premiere-pro/uxp/) — Modern API (v25.6+), action-based
4. **Adobe CEP Samples** (github.com/Adobe-CEP/Samples/PProPanel) — Official sample ExtendScript
5. **adb-mcp** (github.com/mikechambers/adb-mcp) — UXP-based MCP for Premiere (Python + proxy)
6. **hetpatel-11/Adobe_Premiere_Pro_MCP** — CEP-based MCP (same architecture as ours)

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
| `clip.remove(inRipple, inAlignToVideo)` | Remove clip | ✅ |
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
| `qeClip.rippleDelete()` | Ripple delete | ✅ |
| `qeClip.move(newTime)` | Move clip | ❌ |
| `qeClip.moveToTrack(trackIdx)` | Move to different track | ✅ |
| `qeClip.roll(newTime)` | Roll edit | ✅ |
| `qeClip.slide(offset)` | Slide edit | ✅ |
| `qeClip.slip(offset)` | Slip edit | ✅ |
| `qeClip.setSpeed(speed, ...)` | Set playback speed | ✅ |
| `qeClip.setReverse(reverse)` | Reverse playback | ✅ |
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

## Implementation Status — Priority List

**Total tools: 269 across 28 modules** (up from 228 across 23 modules)

### P0 — Critical ✅ ALL IMPLEMENTED
1. ~~**`create_project`**~~ — ❌ Intentionally skipped (requires UXP, not available via ExtendScript CEP)
2. ✅ **`create_sequence_from_clips`** — `project.createNewSequenceFromClips` (advanced.ts)
3. ✅ **`overwrite_clip`** — `seq.overwriteClip` (advanced.ts)
4. ✅ **`ripple_delete`** — QE DOM (advanced.ts)
5. ✅ **`close_gaps`** — QE DOM ripple delete approach (advanced.ts)
6. ✅ **`get_clip_speed`** — `clip.getSpeed()` + `isSpeedReversed()` (advanced.ts)
7. ✅ **`set_clip_speed_qe`** — `qeClip.setSpeed()` (advanced.ts)
8. ✅ **`reverse_clip`** — `qeClip.setReverse()` (advanced.ts)

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

### New modules added
- **workspace.ts** (2 tools) — get_workspaces, set_workspace
- **captions.ts** (1 tool) — create_caption_track
- **playback.ts** (4 tools) — play_timeline, stop_playback, play_source_monitor, get_source_monitor_position
- **project-manager.ts** (1 tool) — consolidate_and_transfer
- **health.ts** (1 tool) — ping

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

We should add a similar resource to our server.
