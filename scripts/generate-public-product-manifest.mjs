import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_PATH = resolve("public-product-manifest.json");

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(relativePath), "utf8"));
}

export async function buildPublicProductManifest() {
  const [release, packageJson, registry] = await Promise.all([
    readJson("release-metadata.json"),
    readJson("package.json"),
    readJson("registry/server.json"),
  ]);

  return {
    schemaVersion: "premiere-pro-mcp.public-product.v1",
    generatedFrom: {
      releaseMetadata: "release-metadata.json",
      packageMetadata: "package.json",
      registryMetadata: "registry/server.json",
    },
    product: {
      name: "MCP for Adobe Premiere Pro",
      mcpName: packageJson.mcpName,
      npmPackage: packageJson.name,
      version: release.version,
      repository: "https://github.com/leancoderkavy/premiere-pro-mcp",
      homepage: packageJson.homepage,
      license: packageJson.license,
      localFirst: true,
      transport: registry.packages?.[0]?.transport?.type ?? "stdio",
    },
    compatibility: {
      node: packageJson.engines?.node,
      premiere: release.premiereVersions,
      uxpMinimumVersion: release.uxpMinimumVersion,
      operatingSystems: ["Windows", "macOS"],
    },
    capabilitySurface: {
      registeredCoreTools: release.coreTools,
      defaultProfileTools: release.defaultProfileTools,
      authenticatedUxpAdditions: release.uxpAdditionalTools,
      defaultProfileWithUxp: release.defaultProfileWithUxpTools,
      toolModules: release.toolModules,
      guidedWorkflows: release.guidedWorkflows,
    },
    workflows: [
      {
        id: "safe-project-intake",
        title: "Inspect and organize a project safely",
        documentation: "docs/ai-editorial-workflows.md",
        firstTools: ["get_project_info", "manage_project_context", "create_editorial_plan", "preview_editorial_plan"],
        mutationBoundary: "Planning is local and review-only; any later Premiere mutation has its own capability, confirmation, and readback contract.",
      },
      {
        id: "transcript-backed-rough-cut",
        title: "Build a transcript-backed rough-cut proposal",
        documentation: "docs/ai-editorial-workflows.md",
        firstTools: ["manage_project_context", "create_editorial_context_pack", "create_editorial_plan", "preview_editorial_plan"],
        mutationBoundary: "Context packs and plans never transcribe, call an AI provider, or remove timeline media.",
      },
      {
        id: "caption-review",
        title: "Import and structurally review captions",
        documentation: "docs/ai-editorial-workflows.md",
        firstTools: ["create_caption_track", "get_sequence_structure"],
        mutationBoundary: "Caption-track readback is structural acceptance only; playback, readability, and render verification remain separate.",
      },
      {
        id: "verified-delivery",
        title: "Prepare and verify a delivery",
        documentation: "docs/supported-actions.md",
        firstTools: ["export_sequence", "verify_export", "analyze_video_qc"],
        mutationBoundary: "An export request, file check, and quality review establish different evidence levels and do not publish a delivery.",
      },
    ],
    verification: {
      automated: "Tests and generated catalogs prove package behavior, schemas, routing, bounds, and documented readback contracts.",
      host: "A real supported Premiere host is required to establish host behavior; this manifest contains no licensed-host claim.",
      playbackAndRender: "Structural readback does not establish playback, visual quality, audio quality, caption readability, or final render quality.",
      details: "docs/editorial-workflow-host-validation.md",
    },
    proofKit: {
      status: "runbook_and_redacted_template_only",
      runbook: "docs/workflow-proof-runbook.md",
      receiptTemplate: "docs/workflow-proof-receipt.template.json",
      video: null,
      note: "No walkthrough video or licensed-host receipt is claimed until a fixture-only run is recorded and reviewed.",
    },
    communityCoverage: {
      status: "independent_historical_reports",
      documentation: "docs/community-coverage.md",
      note: "External reports are historical user experiences, not current compatibility or support claims.",
    },
  };
}

function render(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const checkOnly = arguments_.includes("--check");
  const unknown = arguments_.filter((argument) => argument !== "--check");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);

  const expected = render(await buildPublicProductManifest());
  if (checkOnly) {
    const current = await readFile(OUTPUT_PATH, "utf8").catch(() => "");
    // Git may materialize text files with CRLF on Windows while generators
    // deliberately emit LF. Compare content, not the checkout's line-ending
    // convention, so the release gate remains portable.
    if (current.replace(/\r\n?/g, "\n") !== expected) {
      throw new Error("public-product-manifest.json is stale. Run npm run product-manifest.");
    }
    console.log("Public product manifest is current.");
    return;
  }

  await writeFile(OUTPUT_PATH, expected, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
