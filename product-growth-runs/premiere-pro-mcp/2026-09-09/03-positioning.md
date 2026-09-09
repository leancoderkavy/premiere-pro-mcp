# Positioning and feature priorities

Product: MCP for Adobe Premiere Pro. Market: technical editors and assistant editors.
Date: September 9, 2026. Scope: organic evaluation and onboarding.
Status: recommended positioning; performance differentiation remains unproven.

Primary audience: an editor or small post team evaluating one repeatable local
workflow with their preferred assistant. The immediate job is to connect the
correct software, inspect a project, and get a useful result they can check.

| ID | Message | Evidence and application |
| --- | --- | --- |
| ANG-001 | Connect your assistant to a Premiere workflow you can inspect and verify. | INS-004; primary direction, demonstrated with a small workflow |
| ANG-002 | Configure the exact installation you intend to run. | INS-001; CLI helper and comparison guide |
| ANG-003 | Try the same project, inspect the result, and share what happened. | INS-004; existing synthetic kit plus real-host receipt |

| Priority | Outcome | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| P0, implemented in this branch | Deterministic client setup output | Four formats, absolute executable/entrypoint paths, no writes, mixed actions rejected | INS-001 |
| P0, before a workflow campaign | Real first-use proof | Exact released versions; connection, sequence inspection and limitations documented on Windows/macOS | INS-004 |
| P1 | Reliable product-spot workflow | Same synthetic media and intended timing; preview, approval, timeline, Undo, reopen and playback reviewed | INS-004 |
| P1 | Review/delivery handoff proof | Approved file outputs checked for existence/content, with host and render evidence kept distinct | INS-004 |
| P2, based on observed failures | Client and connector recovery | Repeated external setup failures reproduced and resolved | INS-006 |

Objection: the other repo has more stars. Response: that is currently true; try a
common workflow and compare outcomes. Objection: a larger catalog means it is
better. Response: ask which operations are supported on the intended host and how
success is verified. Neither objection warrants an unsupported superiority claim.

Next actions: make ANG-001 demonstrable, then distribute that evidence.
Owner: maintainer and independent workflow evaluators.
Approval needed: any external campaign or request to others.
Completion criteria: chosen message is supported by a reproducible workflow, not just copy.
