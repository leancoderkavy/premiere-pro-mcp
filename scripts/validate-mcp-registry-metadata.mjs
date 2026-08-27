import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (relativePath) => JSON.parse(readFileSync(join(root, relativePath), "utf8"));
const packageJson = readJson("package.json");
const manifest = readJson("registry/server.json");
const readme = readFileSync(join(root, "README.md"), "utf8");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const mcpName = packageJson.mcpName;
const npmPackage = manifest.packages?.[0];

expect(typeof mcpName === "string" && /^io\.github\.leancoderkavy\/[a-z0-9-]+$/.test(mcpName), "package.json mcpName must use the leancoderkavy GitHub namespace");
expect(manifest.name === mcpName, "registry/server.json name must match package.json mcpName");
expect(manifest.version === packageJson.version, "registry/server.json version must match package.json version");
expect(manifest.repository?.url === "https://github.com/leancoderkavy/premiere-pro-mcp", "registry/server.json must reference the canonical GitHub repository");
expect(npmPackage?.registryType === "npm", "registry/server.json must describe an npm package");
expect(npmPackage?.identifier === packageJson.name, "registry npm identifier must match package.json name");
expect(npmPackage?.version === packageJson.version, "registry npm package version must match package.json version");
expect(npmPackage?.transport?.type === "stdio", "registry transport must stay local stdio");
expect(readme.includes(`<!-- mcp-name: ${mcpName} -->`), "README must retain the package mcp-name verification marker");

if (failures.length) {
  console.error(`MCP Registry metadata validation failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`MCP Registry metadata is internally aligned for ${mcpName}@${packageJson.version}.`);
}
