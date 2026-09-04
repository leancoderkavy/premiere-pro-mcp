# MCP Registry readiness

**Status:** v1.14.8 local and published-npm metadata verified on 2026-09-04; not submitted to the official registry.

The official MCP Registry is a separate public listing. A repository change, an npm package, or a GitHub release does not create a listing. Submission requires a user-authorized registry login and publication action.

The verified v1.14.8 npm artifact exposes
`mcpName: io.github.leancoderkavy/premiere-pro`, and its checked-in `registry/server.json`
matches the published package name, version, repository, and local `stdio`
transport. Run the official validator and the read-only preflight below at the
moment of submission; their results are readiness evidence, not a publication
claim.

Before an owner-authorized submission:

1. Run `npm run validate:mcp-registry-metadata` followed by
   `npm run preflight:mcp-registry`. The latter checks the published npm
   artifact and searches the official registry; it does not authenticate or
   publish.
2. Inspect `registry/server.json` from the exact release tag and confirm the
   entry continues to describe only the local `stdio` route. Do not present the
   local Premiere bridge as a hosted service.
3. Obtain action-time approval, authenticate with `mcp-publisher login github`,
   and publish once with `mcp-publisher publish registry/server.json`.
4. Query the registry for the exact listing name and retain the returned URL as
   public evidence. Do not create a second record merely because search results
   are delayed.

Use only these evidence-bounded facts in a future directory entry:

- Free, MIT-licensed, local-first MCP server for supported Premiere Pro workflows.
- A compatible AI client calls structured tools through a local Premiere connection.
- Begin with `verify_premiere_connection`; support remains capability- and host-dependent.
- The chosen AI client's privacy behavior is separate from the server's local-first recommendation.

Do not submit until the package version, transport, authentication expectations, privacy disclosures, and source URL are all verified for that directory.

Official references:

- <https://modelcontextprotocol.io/registry/quickstart>
- <https://registry.modelcontextprotocol.io/docs>
- <https://modelcontextprotocol.io/registry/faq>
