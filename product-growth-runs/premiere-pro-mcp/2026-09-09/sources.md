# Sources

Product: MCP for Adobe Premiere Pro. Market: local Premiere MCP integrations.
Date: September 9, 2026. Scope: public metadata, source inspection and search.
Status: checked during this run; linked moving APIs will change after this date.

- SRC-001: [Our package at inspected main](https://github.com/leancoderkavy/premiere-pro-mcp/blob/dcafe7a/package.json).
- SRC-002: [Other package at inspected commit](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/ee31c3def7c3ca1c68662ea7737a9f8e5a2b634f/package.json).
- SRC-003: [Our v1.15.0 release](https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v1.15.0) and [published facts](https://premiere-pro-mcp.com/facts/); local `landing/lib/published-release.json` carries artifact provenance.
- SRC-004: [Other README at inspected commit](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP/blob/ee31c3def7c3ca1c68662ea7737a9f8e5a2b634f/README.md).
- SRC-005: [Official registry namespace query](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.leancoderkavy/premiere-pro). Returned v1.15.0 active/latest, published September 8, 2026.
- SRC-006: [Our GitHub repository API](https://api.github.com/repos/leancoderkavy/premiere-pro-mcp).
- SRC-007: [Other GitHub repository API](https://api.github.com/repos/hetpatel-11/Adobe_Premiere_Pro_MCP).
- SRC-008: [Our exact npm window](https://api.npmjs.org/downloads/point/2026-08-31:2026-09-06/premiere-pro-mcp).
- SRC-009: [Other exact npm window](https://api.npmjs.org/downloads/point/2026-08-31:2026-09-06/adobe-premiere-pro-mcp).
- SRC-010: Live web search sample, queries `Premiere Pro MCP` and `Adobe Premiere Pro MCP server AI video editing`. Returned both repositories and [our workflow guide](https://premiere-pro-mcp.com/blog/ai-video-editing-with-premiere-pro/), [our explainer](https://premiere-pro-mcp.com/blog/what-is-a-premiere-pro-mcp-server/), and [their website](https://premiere-mcp.com/). Engine-specific rank and locale were not available; no position inferred.
- SRC-011: [npm bin mapping](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin), [VS Code configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Cursor configuration](https://cursor.com/docs/mcp), [Codex configuration](https://developers.openai.com/codex/mcp).
- SRC-012: [GitHub repository search API sample](https://api.github.com/search/repositories?q=premiere%20pro%20mcp&per_page=100&page=1) and [GitHub's best-match semantics](https://docs.github.com/en/rest/search/search#ranking-search-results). Exact query `premiere pro mcp`, unauthenticated, page 1, limit 100; 47 returned, incomplete_results false; ours second, named competitor first at 07:21 UTC.

Next actions: refresh changing facts before reusing public comparison claims.
Owner: maintainer.
Approval needed: none for these public read-only sources.
Completion criteria: each material claim points to its source and dated snapshot.
