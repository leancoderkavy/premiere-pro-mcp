import { appendFileSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const expected = JSON.parse(readFileSync(new URL("../registry/server.json", import.meta.url), "utf8"));
const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(expected.name)}/versions/${encodeURIComponent(expected.version)}`;
const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
if (response.status === 404 && process.argv.includes("--allow-missing")) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "published=false\n");
  console.log(`No published record yet: ${expected.name}@${expected.version}`);
} else {
  if (!response.ok) throw new Error(`Registry verification failed: HTTP ${response.status}`);
  const body = await response.json();
  const actual = body.server ?? body;
  for (const key of ["name", "version", "title", "description", "repository", "packages"]) {
    if (!isDeepStrictEqual(actual[key], expected[key])) throw new Error(`Published registry ${key} differs from the reviewed manifest; stop before publishing.`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "published=true\n");
  console.log(`Verified official MCP Registry record: ${url}`);
}
