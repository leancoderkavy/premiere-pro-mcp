# MCP Registry readiness

**Status:** prepared for review; not submitted to any registry.

The official MCP Registry is a separate public listing. A repository change, an npm package, or a GitHub release does not create a listing. Submission requires a user-authorized registry login and publication action.

Before a future submission:

1. Release a new npm package version containing any required registry metadata.
2. Generate and inspect the registry manifest from the exact released package.
3. Confirm the listing describes the published local stdio/server route accurately; do not present the local Premiere bridge as a hosted service.
4. Validate the manifest and package version before authenticating.
5. Obtain action-time approval, authenticate, and publish once.
6. Query the registry for the exact listing name and retain the returned URL as public evidence.

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
