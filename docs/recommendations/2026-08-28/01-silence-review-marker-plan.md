# Silence review marker plan

## Repository-fit gap

`detect_silence` already makes a local FFmpeg analysis available, but its returned
timecodes are explicitly relative to the source media. It could not translate a
silence into a timeline position when the source had been trimmed before it was
placed, leaving an editor or agent to do the arithmetic manually.

## External comparison

The current [PremiereProMCP `workflow_clean_silence` implementation](https://github.com/CaYatur/PremiereProMCP/blob/main/server/src/tools/workflow.ts)
detects source silences and sends marker-add commands using those source-derived
timestamps. That is useful automation, but direct marker mutation is unsafe if
the source range or placement does not match the assumed timeline mapping.

## Chosen improvement and benefit

`plan_silence_review_markers` produces bounded candidate ranges for exactly one
known 1x placement. It clips each silence to the supplied source in/out range,
maps the retained range to a timeline start, redacts the local source path, and
does not create markers or modify a sequence. This removes manual trim-offset
math while preserving a human review step before any editorial change.

## Explicit boundary

The plan does not infer speed changes, remapping, reverse playback, multicam,
nested sequences, or rendered timeline audio. Those cases require Premiere-host
evidence rather than arithmetic from a decoded source file.
