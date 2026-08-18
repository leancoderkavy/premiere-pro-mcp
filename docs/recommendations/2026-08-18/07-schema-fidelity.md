# Recommendation 07: JSON Schema constraint fidelity

## Evidence

Tool parameters are authored as JSON Schema but the server's JSON-Schema-to-Zod
adapter currently preserves types and string enums while dropping bounds such as
`minLength`, `maxLength`, numeric limits, and array limits. MCP treats input schemas
as the tool contract.

- [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## Proposed improvement

Compile supported constraints into Zod, reject unsupported schema keywords during CI,
add integer and non-string enum support, and cap schema depth/size. Do not silently
coerce values or apply defaults that change existing tool behavior.

## Acceptance

- Boundary tests cover strings, numbers, integers, arrays, enums, and nested objects.
- Every catalog schema compiles deterministically with a bounded cache.
- Unsupported keywords produce a build-time migration report.
- Existing valid client calls remain compatible.

This improves server-side validation; it does not validate Adobe host semantics.
