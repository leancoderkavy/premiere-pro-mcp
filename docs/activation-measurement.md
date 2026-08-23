# Activation measurement boundary

The landing measures a bounded, anonymous acquisition funnel without collecting
project data or linking a browser to an editor's Premiere project.

## Browser events

The public landing sends only route/action events and allowlisted campaign values:

1. assistant route selected;
2. versioned download started;
3. safe first prompt copied;
4. illustrated demo played; and
5. supporting CTA/recovery interactions.

Allowed campaign fields are `utm_source`, `utm_medium`, `utm_campaign`,
`utm_term`, and `utm_content`. Values are length-bounded and character-filtered.
Do not add prompts, project details, media names, file paths, tokens, personal
identifiers, or opaque click IDs to this contract.

## Product activation evidence

The local MCP runtime separately emits two aggregate, privacy-bounded events when
`POSTHOG_API_KEY` is configured: a first-run check started and finished. The finished
event records only the CEP/UXP backend and `ready` or `needs_attention` outcome.

Browser acquisition events and local activation telemetry deliberately have no shared
user identifier. Use aggregate funnel trends and voluntary support feedback; do not
claim an individual download completed an install or a Premiere workflow.

## Paid-acquisition gate

Before activating a campaign, verify that conversion actions are receiving events
in the advertising account, that the privacy policy reflects the deployed analytics
behavior, and that the landing's download points to the current release. Campaign
creation, spend, or activation requires separate owner approval.
