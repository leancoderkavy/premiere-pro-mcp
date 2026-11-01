# Signal Theory tool lists

One tool name per line; `#` starts a comment. Each list is 10 to 15 tools chosen
from what the 2026-10-30 bin-cleanup and AAF-turnover sessions and the three
Premiere skills (project cleanup, job cleanup, audio turnover) actually call.
`ping` and `get_capabilities` are always listed, so they are not repeated here.

Load one with:

```bash
PREMIERE_MCP_TOOL_LIST="$(grep -v '^#' fork/packs/cleanup.txt | paste -sd, -)"
```

The variable composes with `PREMIERE_MCP_TOOL_PACKS` (union). A name that no
registered tool matches stops the server at startup.
