# Premiere Pro MCP Tracking Plan

**Last updated:** 2026-08-23

## Decisions this data should inform

1. Which assistant route produces the most connector downloads and safe first checks?
2. Where do visitors abandon setup or open recovery guidance?
3. Which client, OS, and Premiere-version combinations reach a verified server-side tool result?
4. Which acquisition sources produce verified activation rather than page views alone?

## Tools and boundaries

- The public landing uses GA4 for page views and bounded setup interactions.
- The MCP server uses PostHog only when a production key is configured.
- Never send prompts, arguments, tool results, project or media names, file paths, tokens, IP addresses, or profile contents.
- Website analytics and server activation are separate datasets unless an explicit privacy-reviewed anonymous correlation mechanism is introduced later.

## Website events

| Event | Properties | Trigger | Decision |
| --- | --- | --- | --- |
| `primary_cta_clicked` | `location`, `destination` | Hero, final, and guide CTA | Which top-level path earns intent? |
| `marketing_demo_played` | `demo` | First playback per page view | Does the walkthrough support evaluation? |
| `onboarding_assistant_selected` | `assistant` | Assistant route selected | Which setup path is demanded? |
| `onboarding_download_started` | `route` | Bundle, guide, or connector action | Which routes progress to distribution? |
| `onboarding_safe_prompt_copied` | none | Safe prompt copied | Is the visitor preparing to verify? |
| `onboarding_project_intake_prompt_copied` | `prompt_kind` | Project Intake guide prompt copied | Does the outcome-specific route earn an attempted workflow preview? |
| `onboarding_advanced_opened` | none | Advanced setup opened | How often does guided setup fall short? |
| `onboarding_recovery_opened` | none | Recovery help opened | Where does setup friction appear? |

## Server events

| Event | Approved property themes | Funnel stage |
| --- | --- | --- |
| `mcp_connection_attempt` | bounded transport, status, duration | Connection attempt |
| `mcp_request` | bounded method, outcome, status, duration | MCP request |
| `mcp_tool_call` | tool name, outcome, status, duration, bounded error category | Supported action result |
| `premiere_mcp_activation_completed` | selected bridge and fixed `verified_connection` stage | The read-only check confirms the selected bridge, an open project, and an active sequence |

## GA4 conversions to configure

- Mark `onboarding_download_started` as a key event.
- Mark `onboarding_safe_prompt_copied` as a key event.
- Keep `marketing_cta_clicked` and `marketing_demo_played` diagnostic rather than primary conversions.
- Use lowercase UTM values: `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content`.

## Activation reporting boundary

The repository-owned activation signal is emitted only when `verify_premiere_connection` returns `ready`: the MCP client reached the server, the selected bridge answered, and Premiere reported an open project and active sequence. A website download, connection attempt, incomplete diagnostic, or generic successful tool call is not activation.

There is no privacy-safe way to identify an editor's or client-side installation's first supported value from this event: it carries no editor, project, or client-installation identifier. `mcp_tool_call` remains operational telemetry, not a first-value conversion or proof of a host-observable workflow result.

## Validation checklist

- Confirm each browser event once in GA4 DebugView without duplicate firing.
- Confirm no analytics payload includes user content or local paths.
- Verify server events in the intended PostHog project after deployment.
- Segment server outcomes by client, OS, Premiere major version, and tool only when those fields are bounded and available.
- Review event volume and error categories monthly; retire events that do not change a decision.
