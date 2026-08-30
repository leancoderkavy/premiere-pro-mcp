# Distribution readiness and owner gates

This document separates build evidence from public distribution approval. A
generated artifact is not automatically signed, trusted, Marketplace-approved,
or verified inside a real Premiere host.

## Recommended user routes

| User | Server package | Premiere connector | Current evidence |
| --- | --- | --- | --- |
| Claude Desktop editor | `.mcpb` | Direct `.ccx` on supported UXP hosts, CEP installer for compatibility | Package validation only until installed in a real host |
| Other MCP client | npm/local stdio | Direct `.ccx` or CEP installer | Guided setup; no native client-specific installer |
| Managed enterprise | Managed MCP configuration | Adobe Admin Console or UPIA for `.ccx` | Requires enterprise administrator validation |

Adobe documents that independently distributed `.ccx` files can be installed
by double-clicking them in Creative Cloud Desktop. This is the preferred
nontechnical connector route for supported Premiere versions. CEP remains the
compatibility route for older hosts and operations not offered by UXP.

## Automated artifacts

- `npm run build:claude` creates and validates the current MCPB bundle.
- `node scripts/build-uxp-ccx.mjs` creates the deterministic direct CCX.
- `scripts/build-connector-installer.ps1` creates a self-contained Windows CEP
  installer with no Node.js requirement.
- `scripts/build-connector-installer.sh` creates a macOS CEP installer package.
- `.github/workflows/connector-installers.yml` builds preview installers on a
  PR and fails closed when a production run requires unavailable signing
  identities.

The Windows installer installs only to the current user's Adobe CEP extension
folder and validates ZIP paths before extraction. The macOS package installs
the connector into Adobe's system-wide CEP extension folder. Both require a
complete Premiere restart before connection verification.

## Updating an installed copy

A published release is the update signal for local copies. A deployment of the
hosted MCP endpoint changes only that operator-managed service; it does not
update a user's local npm server, CEP connector, or Claude extension.

For a global npm installation, users can run `premiere-pro-mcp --check-update`
to see the current npm `latest` version. After fully quitting Premiere,
`premiere-pro-mcp --update` installs that published package and refreshes the
per-user CEP connector. It does not alter MCP client configuration or project
files. Source users can run `npm run check-update:source` and then
`npm run update:source`; the source path refuses dirty or locally-ahead
checkouts and uses a fast-forward-only update before rebuilding and refreshing
the connector. Claude Desktop `.mcpb` bundles remain user-installed extension
packages and must be replaced from the matching release asset.

## Connector removal

Fully quit Premiere before removal. The command-line path removes only this
connector and deliberately leaves Adobe's shared `PlayerDebugMode` setting
unchanged, because another CEP extension may rely on it:

```bash
premiere-pro-mcp --uninstall-cep
```

For a Windows release installer, `PremiereConnectorInstaller.exe --uninstall
--quiet` is also an idempotent per-user removal path. The native installer and
the CLI refuse removal while Premiere is running.

The macOS `.pkg` installs system-wide. The macOS installer build publishes the
matching `Premiere-Connector-Uninstall-<version>-macos.command` companion; run
it from Terminal with administrator permission:

```bash
sudo ./Premiere-Connector-Uninstall-<version>-macos.command --system
```

This removes only `/Library/Application Support/Adobe/CEP/extensions/MCPBridgeCEP`.
Remove the MCP server configuration from the AI client and any npm package
separately; connector removal never edits unrelated client configuration.

## External owner actions

### Windows public installer

Configure a publicly trusted Authenticode identity. Microsoft recommends its
managed Artifact Signing service or a trusted OV certificate for independent
distribution. Repository secrets expected by CI:

- `WINDOWS_SIGNING_PFX_BASE64`
- `WINDOWS_SIGNING_PFX_PASSWORD`

Do not publish the preview EXE. CI labels it unsigned and a production dispatch
with `require_production_signing=true` refuses to finish without a certificate.

### macOS public installer

The owner must supply an Apple Developer Installer identity, signing keychain,
and notarization credentials. The checked-in builder accepts
`MAC_INSTALLER_IDENTITY` and refuses a production build when signing is
required but absent. Notarization and stapling must be added only after the
owner selects the Apple credential mechanism; repository code must never
contain those credentials.

### Adobe Creative Cloud Marketplace

Create the public publisher profile and listing in Adobe Developer
Distribution, then provide the Adobe-issued Marketplace plugin ID to the
manual UXP packaging workflow. The workflow intentionally refuses to reuse the
direct-distribution ID. Submission, review, and publication remain owner- and
Adobe-controlled actions.

Required listing material:

- 48, 96, and 192 pixel plugin icons;
- at least one 1360x800 screenshot;
- a 250x250 publisher logo for a first publisher profile;
- privacy/support URLs and reviewer instructions;
- the Marketplace-channel CCX built with the Adobe-issued ID.

### Claude Desktop directory

The MCPB bundle is structurally validated but not signed by this repository.
The owner must obtain a trusted signing identity and Anthropic directory or
organization approval. A self-signed identity is not a substitute for that
approval.

## Live-host release gate

Before any installer is described as verified, test the exact downloaded bytes
on Windows and macOS with real supported Premiere installations. Exercise
install, repair, upgrade, uninstall, missing connector, Premiere closed, no
project, no sequence, successful read-only verification, and one failure path.
Record host version, operating system, artifact SHA-256, result, and limitation.

Official references:

- [Adobe UXP distribution overview](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/overview/)
- [Adobe UXP installation](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/)
- [Adobe Marketplace listing requirements](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/listing/)
- [Microsoft MSIX and code-signing guidance](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options)
