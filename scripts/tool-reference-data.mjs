import { createHash } from "node:crypto";

const surfaces = {
  "Default profile": "default",
  "Connected UXP": "uxp",
  "Requires `unsafe-script`": "restricted",
};

/** Consume only the generated tool rows, failing closed if their format drifts. */
export function buildToolReference(markdown, source) {
  const normalized = markdown.replaceAll("\r\n", "\n");
  const tools = normalized.split("\n").filter((line) => line.startsWith("| `")).map((line) => {
    const match = line.match(/^\| `([a-z0-9_]+)` \| (.*?) \| (.*?) \| (.*?) \|$/);
    if (!match || !Object.hasOwn(surfaces, match[2]) || !match[4]) {
      throw new Error("Unexpected supported-actions tool row; update the reference generator.");
    }
    const plain = (text) => text.replaceAll("\\|", "|").replaceAll("`", "");
    return { name: match[1], surface: surfaces[match[2]], modes: plain(match[3]), description: plain(match[4]) };
  });
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error("Duplicate tool reference name");
  const counts = Object.fromEntries(Object.values(surfaces).map((surface) => [surface, tools.filter((tool) => tool.surface === surface).length]));
  if (counts.default !== source.defaultProfileTools || counts.uxp !== source.uxpAdditionalTools ||
      counts.default + counts.restricted !== source.coreTools ||
      counts.default + counts.uxp !== source.defaultProfileWithUxpTools || tools.length === 0) {
    throw new Error("Tool reference counts do not match source release metadata");
  }
  return {
    schemaVersion: 1,
    evidenceScope: "source_catalog_may_include_unreleased_work",
    sourceVersion: source.version,
    sourcePath: "docs/supported-actions.md",
    sourceSha256: createHash("sha256").update(normalized).digest("hex"),
    hostVerification: "not_established_by_catalogs",
    counts,
    tools: tools.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  };
}
