# Marker-anchored review frames

## Repository-fit gap

The server already exports evenly spaced sequence review frames and clip-midpoint
frames, while `list_markers` exposes marker positions separately. An editor or
agent wanting a visual receipt for existing review markers therefore has to list
the markers and make one individual frame-export call for every marker. Evenly
spaced sampling can miss the annotated moments entirely.

## Competitive observation

The current [Adobe Premiere Pro MCP catalog](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/main/README.md)
promotes marker discovery and batch-oriented editing as first-class workflow
building blocks. Its source also implements bounded, per-item batch requests
such as [`add_to_timeline_batch`](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/main/src/tools/index.ts).
That supports the product need for marker-based batch handoff, but this project
does not reuse the competitor implementation or its unsupported-host claims.

## Chosen improvement and benefit

`export_sequence_marker_review_frames` reads the active sequence's existing
markers once, sorts and bounds the matches, and exports a file-verified
composite frame at each selected marker start in the same bridge request. It
can narrow by marker type and time range, reports truncation and partial file
failures, and never changes any Premiere marker. This turns an N+1 bridge-call
review loop into one bounded call while keeping the returned frame paths and
verification scope explicit.
