# 30-Day Adoption Plan

**Date:** 2026-07-27

## Objective

Increase verified successful local activations of MCP for Adobe Premiere Pro, not merely repository traffic or package downloads. The current public signals show interest, but they do not establish how many people have connected a real Premiere host or completed an edit.

## Starting signals and measurement boundary

| Signal | Latest observed evidence | What it means | What it does not mean |
| --- | --- | --- | --- |
| GitHub traffic | 1,194 unique visitors and 835 unique cloners over Jul 13–26 | Discovery and evaluation interest | Active installs or successful editing sessions |
| npm | 1,591 downloads over Jun 25–Jul 24 | Package distribution interest | Unique users or completed setup |
| Production MCP telemetry | Not configured | No current activation funnel | No conclusion about past usage |

Before judging conversion, create a dedicated PostHog project, set the production `POSTHOG_API_KEY` secret, deploy the telemetry release, and confirm that privacy-safe events arrive. The relevant funnel is: `mcp_connection_attempt` → `mcp_request` → `mcp_tool_call` with a successful outcome.

## Days 1–7: reduce setup friction

1. Publish the landing and README corrections in this change: Node.js 20.19+ everywhere, npm-first client configuration, and bridge verification before edits.
2. Add a short compatibility matrix that distinguishes packaged support from host-verified operations, including current QE DOM limitations.
3. Record three short, real Premiere walkthroughs: inspect a project, plan a non-destructive edit, and complete one verified export. Show the Premiere version and the tool result in each.
4. Claim and correct the Glama directory listing. Use the local-first setup, current package link, and host-verification boundary; do not list remote access as a replacement for the local CEP bridge.

**Exit evidence:** the published landing and README agree with `package.json`; one clean-machine installation can reach `get_capabilities` and `ping`; the directory listing points to the current setup.

## Days 8–14: reach the right users

1. Publish the three walkthroughs as a release post, README links, and short clips for editor/developer communities where MCP workflows are discussed.
2. Create client-specific setup pages only after testing each client against the current package. Prioritize Claude Desktop, Cursor, Windsurf, and VS Code/Copilot because the repository already documents them.
3. Turn high-frequency setup errors into concise troubleshooting entries, beginning with CEP signature, restart, temp-directory, and Premiere-version checks.
4. Invite existing issue reporters and star/fork users to test the updated path; ask for Premiere version, OS, client, and whether `get_capabilities` and `ping` succeeded, never project media or paths.

**Exit evidence:** each promoted client path has a fresh, reproducible test; issue templates capture compatibility information without asking for sensitive project data.

## Days 15–21: convert interest into repeat use

1. Put three outcome recipes near the top of the README and landing: project inventory, safe edit plan, and verified export.
2. Add a release checklist that pairs every feature claim with a host version and observable result.
3. Triage the top failed connection and tool-call event types from PostHog; ship only evidence-backed fixes and document known host-specific limits.
4. Add a lightweight feedback request after a successful first session, linking to GitHub Issues or Discussions rather than collecting media data.

**Exit evidence:** the first-use funnel has a measured baseline; the most common failure has an owner, status, and documented workaround or fix.

## Days 22–30: improve from evidence

1. Compare the activation funnel by client, OS, and Premiere major version using only the bounded telemetry fields.
2. Prioritize the one onboarding step with the largest verified drop-off; avoid optimizing traffic until the connection and tool-success stages are understood.
3. Refresh the directory listing, website, npm description, and release notes with only claims demonstrated in the walkthroughs and telemetry.
4. Publish a transparent monthly compatibility update: tested host versions, known QE/UXP gaps, fixes shipped, and the next validation target.

**Exit evidence:** a baseline report distinguishes traffic, downloads, connections, requests, and successful tool calls; the next 30-day priority is selected from that report.

## Owners and external gates

| Work | Owner | Gate |
| --- | --- | --- |
| Landing/README release | Repository maintainer | Review, merge, and deploy this change |
| PostHog activation funnel | Repository maintainer | Choose or create a dedicated PostHog project, set Fly secret, deploy, verify events |
| Glama listing | Account holder | Claim access to the directory listing |
| Compatibility proof | Maintainer or volunteer with a real host | Test the promoted client/OS/Premiere combination |

Do not treat a GitHub clone, npm download, HTTP health check, or unauthenticated production log line as proof of a working Premiere session.
