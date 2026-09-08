# Cross-app workflow planning

`plan_cross_app_workflow` connects the existing After Effects and Premiere tools
into an ordered handoff checklist. It returns dependencies, approval boundaries,
evidence needed at each step, and a stop/recovery policy. It performs no host or
filesystem calls and does not execute, approve, or track the workflow.

```json
{ "workflow": "ae_mogrt_to_premiere" }
```

This route connects recipe preview, approved creation, local artifact checks,
Premiere connection, a separate handoff preview and approval, and visual review.
The target must be an empty track in a disposable `MOGRT Verify - …` sequence.
See [MOGRT authoring](mogrt-authoring.md) for connector setup and tool arguments.

```json
{ "workflow": "ae_render_to_premiere" }
```

This route connects host template inspection, queue preview and approval,
**manual rendering**, output-file verification, approved project-bin import,
and project readback. Queue success is not render completion. The server cannot
start or monitor the After Effects render. The route ends with imported project
media, not a placed timeline clip or a verified final delivery.

## Following a plan

1. Discover the returned `required_tools` in the current MCP session and inspect
   their input schemas. Tool packs and capabilities can hide or deny a route.
   Listing a tool in a plan is not evidence that it is available or authorized.
2. Execute serially, checking `evidence_required` after each step. All returned
   statuses are `not_executed`; the revision is a digest of the checklist, not
   a preview token, execution receipt, or source-project revision.
3. Obtain separate approval for each mutation. Existing one-time preview tokens
   retain their own expiry and authority checks. `import_media` has no preview
   token: ask the user to approve the exact verified file and target bin before
   calling it. No approval is inherited across applications.
4. Stop at failure or missing evidence. Inspect actual host/artifact state before
   retrying; do not replay successful mutations or claim cross-app rollback.
   Capture individual tool receipts outside this stateless planner.

The planner accepts only its two recipe names. It does not accept arbitrary
scripts, commands, completion flags, file paths, or approval flags. Photoshop,
Illustrator, Audition, aerender, automatic render jobs, and generic multi-app
execution remain outside this implementation.

## Evidence and origin

The September 6 feature-intelligence run identified a broader cross-app gap from
[Brainferno MCP Bridge v0.3.0](https://github.com/Brainferno/brainferno-mcp-bridge/releases/tag/v0.3.0).
Its [README at commit 9d7c21f30848bbc7a0bf08d0fc821de010fa1b21](https://github.com/Brainferno/brainferno-mcp-bridge/blob/9d7c21f30848bbc7a0bf08d0fc821de010fa1b21/README.md)
was retrieved again September 7, 2026. The repository declares Apache-2.0 and was
updated September 6. Its multi-app pipeline claims are a product signal, not
independently verified host evidence. This planner is an original implementation;
no external code, documentation, or assets were copied. It addresses planning
and approval coordination, not the entire unattended-execution gap.

Adobe's [Premiere UXP API reference](https://developer.adobe.com/premiere-pro/uxp/ppro_reference/)
and [changelog](https://developer.adobe.com/premiere-pro/uxp/changelog/)
describe Premiere APIs, not this cross-app coordinator. No new Adobe API or SDK
support is asserted. Existing repository tool contracts define every route.

Automated tests cover ordering, separate approval boundaries, manual stops,
input rejection, metadata, and deterministic plans. Licensed After Effects and
Premiere validation is still required for creation, actual rendering, import,
control behavior, and audiovisual correctness. Static tests and file checks
cannot establish those outcomes.
