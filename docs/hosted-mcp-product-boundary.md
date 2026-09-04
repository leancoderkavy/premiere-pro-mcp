# Hosted MCP product boundary

**Status:** current product decision (2026-09-04)

The local stdio server is the primary Premiere Pro MCP product. It runs beside
the editor's MCP client and Premiere installation, allowing the local bridge to
inspect a project, preview bounded changes, execute approved operations, and
return receipts.

The deployed HTTP `/mcp` endpoint is an operator-managed transport, not a
public remote Premiere product. Authorizing a caller to that endpoint does not
pair the caller with Premiere running on their own computer, does not establish
device ownership, and does not provide a multi-user editing service.

## Product guidance

- Guide normal editors to the local installation path.
- Do not market the hosted endpoint as a way for customers to control their
  personal Premiere desktop remotely.
- Retain the hosted endpoint only for a named, controlled operator workflow.
  It otherwise adds security, operational, and cost surface without delivering
  a user-facing capability.

## Requirements before productizing remote access

A customer-facing remote offering requires, at minimum:

1. Per-user identity and revocable authorization rather than a shared operator
   token.
2. Secure outbound device pairing between each user's Premiere host and the
   service, with explicit ownership and consent.
3. Per-user isolation for bridge commands, project data, credentials, audit
   records, and rate limits.
4. Live-host validation of the paired workflow, including disconnect,
   revocation, cancellation, and recovery behavior.

Until those conditions are met, availability or authorization of the hosted
endpoint must not be represented as remote control of an editor's local
Premiere installation.
