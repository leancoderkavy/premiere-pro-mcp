# Official MCP Registry publication

`server.json` describes the local stdio npm package. Repository metadata alone
does not establish a public registry listing.

The manual **Publish MCP Registry listing** GitHub Actions workflow publishes
the reviewed manifest from `main` using the repository's GitHub OIDC identity.
It checks local metadata, published npm metadata, and the downloaded npm
tarball's name, version, `mcpName`, and README marker before authenticating.
It skips publication when the exact version already exists and matches the
reviewed metadata, and fails if an existing record differs.

For an authorized publication:

1. Merge and validate the manifest and workflow on `main`.
2. Run `npm run validate:mcp-registry-metadata` and `npm run preflight:mcp-registry`.
3. Dispatch `.github/workflows/mcp-registry-publish.yml` on `main`.
4. Require the workflow's final verification of the exact public record:
   `node scripts/verify-mcp-registry-record.mjs`.

Do not bump or republish npm solely to create a registry entry when the existing
published version already contains the required identity metadata. Do not claim
publication from a preflight or a successful login. Registry version metadata is
immutable; review changes before publishing a new version.

See [official publishing instructions](https://modelcontextprotocol.io/registry/github-actions)
and the [directory facts and outreach draft](../docs/marketing/mcp-registry-readiness.md).
