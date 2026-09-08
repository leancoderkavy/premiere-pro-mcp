import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { product, sourceCatalog } from "../landing/lib/product.js";
import { articles } from "../landing/lib/articles.js";

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
    const llmAlias = read("landing/public/llm.txt");
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
    expect(llmAlias).toContain("https://premiere-pro-mcp.com/llms.txt");
    expect(marketingAssets).toContain(
      `${release.uxpAdditionalTools} additional capability-gated tools`,
    );
    const published = readJson("landing/lib/published-release.json");
    expect(product.version).toBe(published.version);
    expect(product.coreToolCount).toBe(published.coreTools);
    expect(product.defaultProfileToolCount).toBe(published.defaultProfileTools);
    expect(product.connectedUxpToolCount).toBe(published.defaultProfileWithUxpTools);
    expect(sourceCatalog).toEqual(release);
    const articleText = articles.flatMap((article) => article.sections.flatMap((section) => section.paragraphs)).join("\n");
    expect(articleText).toContain(`The published v${published.version} package registers ${published.coreTools} core structured tools`);
    expect(articleText).toContain(`${published.uxpAdditionalTools} capability-gated tools, bringing the connected surface to ${published.defaultProfileWithUxpTools}`);
    expect(product.downloads.claudeBundle).toContain(`/releases/download/v${published.version}/premiere-pro-mcp-${published.version}.mcpb`);
    expect(product.downloads.signedCepConnector).toContain(`/releases/download/v${published.version}/MCPBridgeCEP.zxp`);
    expect(product.downloads.releaseNotes).toContain(`/releases/tag/v${published.version}`);
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

  it("keeps the generated public product manifest aligned with current release metadata", () => {
    const manifest = readJson("public-product-manifest.json");
    expect(manifest.schemaVersion).toBe("premiere-pro-mcp.public-product.v1");
    expect(manifest.product.version).toBe(release.version);
    expect(manifest.product.mcpName).toBe(readJson("package.json").mcpName);
    expect(manifest.capabilitySurface).toMatchObject({
      registeredCoreTools: release.coreTools,
      defaultProfileTools: release.defaultProfileTools,
      authenticatedUxpAdditions: release.uxpAdditionalTools,
      defaultProfileWithUxp: release.defaultProfileWithUxpTools,
      guidedWorkflows: release.guidedWorkflows,
    });
    expect(manifest.proofKit.status).toBe("runbook_and_redacted_template_only");
    expect(manifest.proofKit.video).toBeNull();
    expect(manifest.workflows.map((workflow: { id: string }) => workflow.id)).toEqual([
      "safe-project-intake",
      "transcript-backed-rough-cut",
      "caption-review",
      "verified-delivery",
    ]);
  });
});
