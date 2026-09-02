# UXP capability foundation

The UXP bridge prefers documented Premiere APIs and never silently retries a failed
mutation through CEP or QE. `capabilities.get` reports support from the APIs present
in the connected host rather than from the package version alone.

## Supported command groups

| Command | Premiere | Read only | Undoable | Verification |
|---|---:|---:|---:|---|
| `project.snapshot` | 25.6+ | yes | n/a | revisioned host snapshot |
| `project.save` | 25.6+ | no | no | Premiere return value |
| `sequence.createPreset` | 26.3+ | no | no | created GUID found in project |
| `interchange.export` | 26.2+ | no | no | Premiere return value |
| `transcript.languages` | 26.3+ | yes | n/a | host response |
| `objectMask.has` | 26.3+ | yes | n/a | host response |
| `encoder.configure` | 26.3+ | no | no | mixed; outcome identifies limits |
| `frame.export` | 25.6+ | no | no | exporter result and panel file check |
| `transition.video.*` | 25.6+ | mixed | mutations only | target snapshot plus requested-edge presence/absence readback |

Mutation commands accept an optional `operationId`. The bridge retains the 256 most
recent completed operations and returns the saved result with `replayed: true` when
the same identifier is received again. This prevents a reconnect or client retry
from repeating a completed edit during one panel session.

## Outcome vocabulary

- `verified`: a documented host result or postcondition confirmed the requested state.
- `committed_unverified`: Premiere accepted the operation but exposes no complete
  read-back API for every affected setting.
- `partially_applied`: reserved for a future batch where only some actions committed.
- `not_applied`: represented as a structured command error, never as success.

Capability support and an operation outcome are separate. A command can be supported
by the connected build and still fail because no project or sequence is active.

## Compatibility policy

CEP remains available for Premiere 2020-2025 compatibility. QE-backed tools are
experimental because QE is undocumented. New UXP mutations must use documented
actions inside `Project.lockedAccess()` and `Project.executeTransaction()` whenever
the corresponding Premiere API offers an Action.

Live host validation is still required before broad release claims. The automated
tests use a contract host and prove routing, validation, idempotency, and envelopes;
they do not prove behavior in a particular Premiere build.
