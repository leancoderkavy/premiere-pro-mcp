import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

describe("canonical release metadata", () => {
  const release = readJson("release-metadata.json");

  it("aligns every distributable manifest with the canonical version", () => {
    expect(readJson("package.json").version).toBe(release.version);
    expect(readJson("package.json").description).toContain(
      `${release.coreTools} core AI video editing tools`,
    );
    const packageLock = readJson("package-lock.json");
    expect(packageLock.version).toBe(release.version);
    expect(packageLock.packages[""].version).toBe(release.version);
    expect(readJson("claude-desktop/manifest.json").version).toBe(release.version);
    expect(readJson("uxp-plugin/manifest.json").version).toBe(release.version);
    expect(readJson("plugins/premiere-pro/.codex-plugin/plugin.json").version).toBe(
      release.version,
    );
    expect(
      readJson("claude-plugins/premiere-pro/.claude-plugin/plugin.json").version,
    ).toBe(release.version);
    expect(readJson(".claude-plugin/marketplace.json").plugins[0].version).toBe(
      release.version,
    );

    for (const path of [
      "plugins/premiere-pro/.mcp.json",
      "claude-plugins/premiere-pro/.mcp.json",
    ]) {
      expect(read(path)).toContain(`premiere-pro-mcp@${release.version}`);
    }

    const cepManifest = read("cep-plugin/CSXS/manifest.xml");
    expect(cepManifest).toContain(`ExtensionBundleVersion="${release.version}"`);
    expect(cepManifest).toContain(`Version="${release.version}"`);
    expect(read("cep-plugin/updater.cjs")).toContain(
      `CURRENT_VERSION = "${release.version}"`,
    );
    expect(read("cep-plugin/index.html")).toContain(`Version ${release.version}`);
  });

  it("aligns public release and capability claims", () => {
    const readme = read("README.md");
    const llms = read("landing/public/llms.txt");
    const llmsFull = read("landing/public/llms-full.txt");
    const landingProduct = read("landing/lib/product.ts");
    const landingArticles = read("landing/lib/articles.ts");
    const marketingAssets = read("docs/marketing-assets.md");
    const supportedActions = read("docs/supported-actions.md");

    expect(readme).toContain(`${release.coreTools} core tools`);
    expect(readme).toContain(
      `${release.defaultProfileTools} under the default profile`,
    );
    expect(readme).toContain(
      `${release.defaultProfileWithUxpTools} with a connected UXP bridge`,
    );
    expect(readme).toContain(`${release.uxpAdditionalTools} capability-gated tools`);
    expect(llms).toContain(`Current project release: ${release.version}`);
    expect(llms).toContain(
      `${release.coreTools} core structured MCP tools`,
    );
    expect(llmsFull).toContain(`Current release: ${release.version}`);
    expect(llmsFull).toContain(
      `${release.uxpAdditionalTools} capability-gated tools`,
    );
    expect(llmsFull).toContain(
      `${release.defaultProfileWithUxpTools} connected tools`,
    );
    expect(marketingAssets).toContain(
      `${release.uxpAdditionalTools} additional capability-gated tools`,
    );
    expect(landingProduct).toContain(`version: "${release.version}"`);
    expect(landingProduct).toContain(`coreToolCount: ${release.coreTools}`);
    expect(landingProduct).toContain(`defaultProfileToolCount: ${release.defaultProfileTools}`);
    expect(landingProduct).toContain(`connectedUxpToolCount: ${release.defaultProfileWithUxpTools}`);
    expect(landingArticles).toContain(
      `The server currently registers ${release.coreTools} core structured tools`,
    );
    expect(landingArticles).toContain(
      `${release.uxpAdditionalTools} capability-gated tools, bringing the connected surface to ${release.defaultProfileWithUxpTools}`,
    );
    expect(landingProduct).toContain(
      `/releases/download/v${release.version}/premiere-pro-mcp-${release.version}.mcpb`,
    );
    expect(landingProduct).toContain(
      `/releases/download/v${release.version}/MCPBridgeCEP.zxp`,
    );
    expect(landingProduct).toContain(`/releases/tag/v${release.version}`);
    expect(readme).toContain(`Latest release: ${release.version}`);
    expect(readme).toContain(`registers ${release.coreTools} tools, filtered by authority profile`);
    expect(read("landing/app/changelog/page.tsx")).toContain(
      `version: "${release.version}"`,
    );
    expect(supportedActions).toContain(
      `| Registered core actions | ${release.coreTools} |`,
    );
    expect(supportedActions).toContain(
      `| Default-profile core actions | ${release.defaultProfileTools} |`,
    );
    expect(supportedActions).toContain(
      `| Authenticated UXP additions | ${release.uxpAdditionalTools} |`,
    );
    expect(supportedActions).toContain(
      `| Default profile with UXP | ${release.defaultProfileWithUxpTools} |`,
    );
  });

  it("keeps computed tool-count relationships explicit", () => {
    expect(release.defaultProfileTools + release.uxpAdditionalTools).toBe(
      release.defaultProfileWithUxpTools,
    );
    expect(release.coreTools - release.defaultProfileTools).toBe(2);
  });

  it("keeps the CLI help count aligned with the default profile", () => {
    expect(read("src/index.ts")).toContain(
      `(${release.defaultProfileTools} default-profile tools)`,
    );
  });
});
