# Product Marketing Context

**Version:** v1
**Last updated:** 2026-07-27

## Product

Premiere Pro MCP is an MIT-licensed, local-first Model Context Protocol server for connecting compatible AI clients to Adobe Premiere Pro. It offers structured inspection, editing, automation, and export tools through a local Node.js server and a CEP bridge in Premiere Pro. A UXP bridge is available as a preview for supported capabilities.

## Audience and job to be done

The primary audience is technical video editors, post-production teams, and developers who already use an MCP-capable AI client and want to reduce repetitive Premiere work without moving project media to a hosted editor.

They need a reliable way to inspect a project, plan or carry out repeatable edits, and verify an export from the tools they already use for AI-assisted work.

## Positioning

Use outcome-led, evidence-bounded language:

- Inspect a current project and active sequence before changing anything.
- Plan repeatable timeline work and automate supported actions from an AI client.
- Keep the recommended Premiere, MCP server, CEP bridge, and media on the same computer.
- Verify a real host connection with `get_capabilities` and `ping`; packaged compatibility is not proof that every operation works on every Premiere release.

Do not lead with the tool count alone. The 269-tool surface is supporting proof after the visitor understands the first useful outcome.

## Proof and constraints

- Supported packaged CEP target: Premiere Pro 2020–2026 on Windows and macOS.
- Node.js requirement: 20.19 or newer.
- UXP is a preview for Premiere Pro 25.6 and newer.
- Some QE DOM operations vary by Premiere version; tools should verify resulting state and return diagnostics.
- Remote access still needs authentication and a working connection to the local Premiere bridge. Local stdio is the recommended setup.
- The project is independent and is not affiliated with Adobe Inc.

## Measurement

GitHub traffic, clones, and npm downloads are interest and distribution signals, not verified active users. Measure activation only after the privacy-safe PostHog telemetry is configured with a dedicated project, production secret, and deployed release. Use the funnel: connection attempt → MCP request → successful tool call.

## Customer language

- "What is my current Premiere project and active sequence? Do not make changes."
- "Run `get_capabilities`, then `ping`, with Premiere open."
- "Keep Premiere and project media on the local computer."

## Changelog

- v1 (2026-07-27): Initial context derived from the current product README, package requirements, compatibility guidance, and existing usage-measurement work.
