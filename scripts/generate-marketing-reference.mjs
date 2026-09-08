import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(resolve(root, name), "utf8"));

export async function marketingReferenceFiles() {
  const [published, source, kits] = await Promise.all([
    readJson("landing/lib/published-release.json"), readJson("release-metadata.json"), readJson("landing/lib/workflow-kits.json"),
  ]);
  for (const catalog of [published, source]) {
    if (catalog.defaultProfileTools + catalog.uxpAdditionalTools !== catalog.defaultProfileWithUxpTools) throw new Error("Invalid capability count relationship");
  }
  const origin = "https://premiere-pro-mcp.com";
  const facts = {
    schemaVersion: 1,
    name: "MCP for Adobe Premiere Pro",
    canonicalUrl: `${origin}/facts/`,
    publishedRelease: published,
    developmentSource: { ...source, evidenceScope: "source_catalog_may_include_unreleased_work" },
    hostVerification: "not_established_by_catalogs",
  };
  const short = `# MCP for Adobe Premiere Pro

Free, MIT-licensed, local-first Model Context Protocol server for supported Adobe Premiere Pro workflows. Independent of Adobe. Premiere and the selected AI client have their own requirements and costs.

Preferred product name: **MCP for Adobe Premiere Pro**. Common shorthand: Premiere Pro MCP. npm package: premiere-pro-mcp.

## Published package

Current project release: ${published.version}.
Published v${published.version}: ${published.coreTools} core tools, ${published.defaultProfileTools} default-profile tools, and ${published.uxpAdditionalTools} authenticated capability-gated UXP additions (${published.defaultProfileWithUxpTools} connected tools).
These counts were checked against the downloaded npm artifact and its matching tag. They do not prove a successful operation in a licensed Premiere host.
Release: https://github.com/leancoderkavy/premiere-pro-mcp/releases/tag/v${published.version}

## Development source, separate from publication

Current source metadata registers ${source.coreTools} core structured MCP tools, ${source.defaultProfileTools} in the default profile, and ${source.uxpAdditionalTools} capability-gated tools for ${source.defaultProfileWithUxpTools} connected tools. Source package version: ${source.version}. Main may include changes not in the published package even when its version string is unchanged.

## Start a workflow

Use ${origin}/workflows/ for three downloadable evaluation recipes and synthetic media. The kit is not a recorded live demo or a host-verified project. Project check is read-only; review frames write approved image files; product-spot starter ends at preview.

Install the Claude Desktop bundle and the separate Premiere connector through ${origin}/#install. Other clients use the documented local stdio route. Keep the assistant, server, connector, and Premiere on the same computer for the recommended setup.
First prompt: Safely check my Premiere connection with verify_premiere_connection. Make no changes.
The hosted endpoint does not automatically pair a visitor to their local Premiere. AI client data handling still applies; local-first is not a universal no-upload guarantee.

## References

- Canonical facts: ${origin}/facts/
- Versioned evidence data: ${origin}/marketing-facts.json
- Workflow starter kit: ${origin}/workflows/
- Setup and recovery: ${origin}/docs/troubleshooting/
- Claude setup: ${origin}/blog/claude-desktop-premiere-pro-mcp-setup/
- Workflow automation: ${origin}/blog/premiere-pro-workflow-automation/
- Project Intake: ${origin}/project-intake/
- Guides: ${origin}/blog/
- Documentation: ${origin}/docs/
- Source: https://github.com/leancoderkavy/premiere-pro-mcp
- npm: https://www.npmjs.com/package/premiere-pro-mcp
- Complete reference: ${origin}/llms-full.txt
- Legacy reference alias: ${origin}/llm.txt
`;
  const full = `${short}
## Compatibility and limitations

Current release: ${published.version}. Targets Premiere Pro ${published.premiereVersions} through CEP on Windows and macOS; UXP needs compatible ${published.uxpMinimumVersion}+ hosts and advertised capabilities. Node.js ${published.nodeVersion}+ is required for npm setup; the Claude bundle contains its server runtime.
Editorial context and planning tools do not themselves transcribe media, invoke an LLM, or apply edits. A preview is not an applied operation. A ready connection is not a completed edit. Playback and rendered output require separate inspection.

## Evaluation recipes

${kits.map((kit) => `### ${kit.title}

${kit.summary}
Output: ${kit.output}
${kit.boundary}
Availability: ${kit.availability}
Tools: ${kit.tools.join(", ")}
Prompt: ${kit.prompt}
Recipe: ${origin}/workflows/#${kit.id}
Guide: ${origin}${kit.guide}
`).join("\n")}
## Privacy and reporting

The kit uses synthetic media. Do not submit client projects, paths, prompts, transcripts, or tokens in public reports. Optional browser campaign events and local runtime events have no shared editor identifier. Downloads do not establish activation.
Privacy: ${origin}/privacy/
Security: https://github.com/leancoderkavy/premiere-pro-mcp/blob/main/SECURITY.md
`;
  return {
    "landing/lib/source-catalog.json": `${JSON.stringify(source, null, 2)}\n`,
    "landing/public/marketing-facts.json": `${JSON.stringify(facts, null, 2)}\n`,
    "landing/public/llms.txt": short,
    "landing/public/llms-full.txt": full,
  };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Only --check is supported");
  const check = process.argv.includes("--check");
  for (const [name, expected] of Object.entries(await marketingReferenceFiles())) {
    const target = resolve(root, name);
    if (check) {
      const current = await readFile(target, "utf8").catch(() => "");
      if (current.replace(/\r\n/g, "\n") !== expected) throw new Error(`${name} is stale; run npm run marketing:generate`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, expected);
    }
  }
  console.log(check ? "Marketing references are current." : "Generated marketing references.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
