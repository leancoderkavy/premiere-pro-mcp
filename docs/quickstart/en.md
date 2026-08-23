# Premiere MCP quick start

This is the maintained English source for the translated quick-start guides.
Use it with the repository [README](../../README.md), which has the current
download links and supported-version details.

<!-- quickstart:section=before-you-start -->
## Before you start

Use a copy of a test project, not active client work. The local MCP server, the
Premiere connector, and your AI client must run on the same computer. Start
with a read-only connection check; installation and a green panel status do not
prove an editing workflow has succeeded in a licensed host.

<!-- quickstart:section=install -->
## Install the server and connector

For Claude Desktop, install the current `.mcpb` bundle and the separate signed
Premiere connector from the current GitHub release. Restart both apps.

For another MCP client, install the server and then the CEP connector:

```bash
npm install -g premiere-pro-mcp
premiere-pro-mcp --install-cep
```

Configure the client to run `premiere-pro-mcp`. The full README includes
client-specific JSON examples.

<!-- quickstart:section=prove-connection -->
## Prove the connection safely

1. Open Premiere, open the copied test project, and open an active sequence.
2. In Premiere, choose **Window > Extensions > MCP for Adobe Premiere Pro**.
   “Running” means the panel bridge is available; it is not a completed-edit
   claim.
3. Run the local preflight:

   ```bash
   premiere-pro-mcp --doctor
   ```

4. Ask the AI client: `Run verify_premiere_connection. Make no changes.`

The local doctor reports package/configuration discovery. The MCP response
reports the selected bridge, project, and sequence readiness without returning
project details. Treat a failure or missing sequence as a setup result to fix,
not as permission to retry a mutation.

<!-- quickstart:section=first-edit -->
## Make the first edit deliberately

After the read-only check succeeds, ask for a bounded plan against the copied
test sequence. Review the target, changes, and confirmation boundary before
allowing an edit. Re-inspect the sequence afterwards and use Undo to verify the
fixture returns to its previous state.

<!-- quickstart:section=remove -->
## Remove the connector

Fully quit Premiere first, then remove only this CEP connector:

```bash
premiere-pro-mcp --uninstall-cep
```

This leaves Adobe's shared debug setting unchanged so other CEP extensions are
not disrupted. Remove the MCP server from the AI client's configuration and
uninstall the npm package separately if you no longer use it.
