# Recommendation 31: Adobe sample parity drift check

## Evidence

Adobe’s official Premiere UXP samples exercise projects, sequences, markers, metadata, effects, exports, encoder, transcripts, and project conversion, with manifests treated as authoritative for version compatibility.

- [Adobe Premiere UXP samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)

## Proposed improvement

Add a scheduled, review-only drift job that compares pinned Adobe sample manifests and package versions with this repository’s coverage manifest. Produce candidate gaps without automatically enabling tools or beta APIs.

## Acceptance criteria

- Inputs are pinned by commit SHA and artifact hash.
- Changes open an auditable report, not an automatic production mutation.
- Stable and beta declarations remain separate.
- Removed or changed APIs create blocking review items for affected tools.

Sample usage is implementation guidance, not a compatibility guarantee.
