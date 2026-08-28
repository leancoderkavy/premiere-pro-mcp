# Official MCP Registry candidate

`server.json` is a prepared, unpublished registry record for the local stdio
package. It does not create a public listing.

The next npm release must contain the matching `mcpName` field in
`package.json` and the `mcp-name` marker in the package README before this
record can be published. The already-published `premiere-pro-mcp@1.13.0`
package predates that metadata and cannot validate this versioned record.

Before a future owner-approved publish:

1. Bump the npm package and this manifest to the same new version.
2. Publish and independently inspect the npm tarball.
3. Run `mcp-publisher validate registry/server.json`.
4. Confirm the package and manifest agree on the MCP name, local `stdio`
   transport, repository, version, and capability-limited wording.
5. Obtain action-time approval, then authenticate and publish once.
6. Query the public registry for the returned exact listing URL.

The Registry has immutable version metadata and currently does not offer an
unpublish path. Do not replace these steps with a repository-only check.
