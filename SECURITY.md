# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, **please do not open a public GitHub issue**.

Instead, report it by opening a [GitHub Security Advisory](https://github.com/kavyrattana/pp-mcp/security/advisories/new) (or contact the maintainer directly via GitHub).

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations, if known

You can expect an acknowledgement within **48 hours** and a resolution timeline within **7 days** for critical issues.

## Security Considerations

This MCP server executes ExtendScript inside Adobe Premiere Pro via a CEP plugin. Please note:

- **Script validation** blocks dangerous patterns (`eval()`, `new Function()`, `System.callSystem()`) in user-provided scripts
- **`sendRawCommand()`** bypasses validation and should only be used by trusted clients
- The file-based IPC bridge writes temporary files to the system temp directory — ensure your temp directory has appropriate permissions
- This tool grants AI assistants significant control over Premiere Pro; only connect trusted MCP clients
