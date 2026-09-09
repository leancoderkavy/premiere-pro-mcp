# Product truth

Product: MCP for Adobe Premiere Pro. Market: local Premiere MCP workflows.
Date: September 9, 2026. Scope: competitive claims. Status: evidence recorded.

| Fact | Source | Confidence / state | Allowed use |
| --- | --- | --- | --- |
| Our package is `premiere-pro-mcp`; the other is `adobe-premiere-pro-mcp` | SRC-001, SRC-002 | High / verified metadata | Exact install identity |
| Both declare `premiere-pro-mcp` as a binary | SRC-001, SRC-002 | High / verified source | Explain ambiguity; do not claim a collision was reproduced on an editor's machine |
| Our released v1.15.0 facts report 369 core tools | `landing/lib/published-release.json`, SRC-003 | High / repository artifact provenance | Published catalog size, not working-edit count |
| The other README reports 283 tools, 13 resources, 10 prompts | SRC-004 | Page evidence | Attribute to their inspected README and date |
| Their README reports Premiere 26.0 testing | SRC-004 | Page evidence | Maintainer-reported testing; not independent verification |
| Our v1.15.0 official registry record is active and latest | SRC-005, checked live | High / verified registry response | Publication status; no downstream listing or ranking claim |
| Our local config helper is development source | `src/client-config.ts` and `src/index.ts` | Verified local code | Source setup only until released |
| 240 vs 530 stars; 1,897 vs 1,123 npm downloads in equal dates | Saved baseline, SRC-006–009 | Verified API snapshot | Dated repository/download signals only |
| Later snapshot: 241 vs 530 stars; GitHub API search positions 2 vs 1 | Saved search baseline, SRC-012 | Verified API sample | Exact query and method only; no Google claim |

| Unverified claim | Required evidence |
| --- | --- |
| We rank above the other project | Current GitHub sample instead places us second; require repeated observations and comparable Google Search Console reports |
| We have more active editors | Direct, consent-respecting activation/retention evidence |
| Our workflows are faster or more reliable | Same fixture, package versions, OS/Premiere/client conditions, repeated host runs |
| This configuration was accepted by all four real clients | Individual client discovery and local host checks |
| All registered tools work on a licensed host | Version-specific host execution and outcome verification |

Next actions: use only the allowed claims in public content.
Owner: repository maintainer.
Approval needed: publication only; no new external data access requested.
Completion criteria: each new claim has an inspectable source and the right evidence scope.
