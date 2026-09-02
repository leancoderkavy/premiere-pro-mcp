# Adobe beta TranscriptStatic declaration drift

`src/resources/adobe-beta-transcript-drift.json` records the narrow delta in
the `TranscriptStatic` declaration between this repository's pinned stable
`@adobe/premierepro@26.3.0` package and its pinned
`@adobe/premierepro@26.5.0-beta.73` alias. The package sources are the
[stable npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.3.0)
and the
[pinned beta npm package](https://www.npmjs.com/package/@adobe/premierepro/v/26.5.0-beta.73).

The generated receipt records the beta-added language-pack probe and
transcription-start declaration. It does not add an MCP action or make a
production beta call. Existing stable transcript import/export support remains
separate and unchanged.

In particular, a declaration does not prove a language pack is installed or
usable, that transcription can start or finish, or that transcript content can
be safely retained or exposed. `transcribeClipProjectItem` is treated as a
mutation-sensitive operation and is deliberately excluded from production
support pending a public stable release, compatible documentation, a bounded
privacy-safe design, and controlled licensed-host verification.

Generate the receipt after intentionally changing either pinned package:

```sh
npm run adobe:beta-transcript-drift
```

CI and `npm run check` use `npm run adobe:beta-transcript-drift:check` to
reject a stale receipt.
