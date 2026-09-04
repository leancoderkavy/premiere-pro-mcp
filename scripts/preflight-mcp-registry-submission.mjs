import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (relativePath) =>
  JSON.parse(readFileSync(join(root, relativePath), "utf8"));

const packageJson = readJson("package.json");
const manifest = readJson("registry/server.json");
const npmPackage = manifest.packages?.[0];

function fail(message) {
  console.error(`MCP Registry submission preflight failed: ${message}`);
  process.exitCode = 1;
}

if (!npmPackage || manifest.name !== packageJson.mcpName) {
  fail("local registry metadata does not match package.json; run validate:mcp-registry-metadata first.");
} else if (
  manifest.version !== packageJson.version ||
  npmPackage.identifier !== packageJson.name ||
  npmPackage.version !== packageJson.version ||
  npmPackage.transport?.type !== "stdio"
) {
  fail("local registry package, version, or transport metadata is not publishable.");
} else {
  const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/${encodeURIComponent(packageJson.version)}`;
  const registryUrl = `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(manifest.name)}`;

  try {
    const [npmResponse, registryResponse] = await Promise.all([
      fetch(npmUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(registryUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    if (!npmResponse.ok) {
      fail(`published npm artifact was not found (${npmResponse.status}).`);
    } else if (!registryResponse.ok) {
      fail(`official registry search failed (${registryResponse.status}).`);
    } else {
      const [publishedPackage, registrySearch] = await Promise.all([
        npmResponse.json(),
        registryResponse.json(),
      ]);

      if (
        publishedPackage.version !== packageJson.version ||
        publishedPackage.mcpName !== packageJson.mcpName
      ) {
        fail("published npm artifact does not expose the expected version and mcpName metadata.");
      } else {
        const servers = Array.isArray(registrySearch.servers)
          ? registrySearch.servers
          : [];
        const matches = servers.filter((server) =>
          [server.name, server.server?.name].includes(manifest.name),
        );

        console.log(
          `Published npm artifact verified: ${packageJson.name}@${packageJson.version} (${packageJson.mcpName}).`,
        );
        console.log(
          matches.length
            ? `Official MCP Registry already has ${matches.length} matching record(s) for ${manifest.name}; inspect them before publishing another immutable version.`
            : `Official MCP Registry has no matching record for ${manifest.name}; metadata is ready for the owner-authorized publisher login.`,
        );
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
