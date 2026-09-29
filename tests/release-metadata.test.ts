import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_CATALOG } from "../src/workflows/catalog.js";
import { compareSemver, readPublishedVersion } from "./helpers/published-version.js";

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

    // Client pins name the published npm package, which can trail the source
    // version while a release is being prepared but can never be ahead of it.
    const publishedVersion = readPublishedVersion();
    expect(compareSemver(publishedVersion, release.version)).toBeLessThanOrEqual(0);
    for (const path of [
      "plugins/premiere-pro/.mcp.json",
      "claude-plugins/premiere-pro/.mcp.json",
    ]) {
      expect(read(path)).toContain(`premiere-pro-mcp@${publishedVersion}`);
    }

    const cepManifest = read("cep-plugin/CSXS/manifest.xml");
    expect(cepManifest).toContain(`ExtensionBundleVersion="${release.version}"`);
    expect(cepManifest).toContain(`Version="${release.version}"`);
    expect(read("cep-plugin/updater.cjs")).toContain(
      `CURRENT_VERSION = "${release.version}"`,
    );
    expect(read("cep-plugin/index.html")).toContain(`Version ${release.version}`);
  });

  it("aligns README release and capability claims", () => {
    const readme = read("README.md");
    const supportedActions = read("docs/supported-actions.md");
    const publishedVersion = readPublishedVersion();

    expect(readme).toContain(`${release.coreTools} core tools`);
    expect(readme).toContain(
      `${release.defaultProfileTools} under the default profile`,
    );
    expect(readme).toContain(
      `${release.defaultProfileWithUxpTools} with a connected UXP bridge`,
    );
    expect(readme).toContain(`${release.uxpAdditionalTools} capability-gated tools`);
    expect(readme).toContain(`The published v${publishedVersion} npm artifact`);
    expect(readme).toContain(`registers ${release.coreTools} tools, filtered by authority profile`);
    // Website facts are synced from the published npm tarball by the separate
    // site repository; the README links to them instead of restating provenance.
    expect(readme).toContain("https://premiere-pro-mcp.com/facts/");
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
    expect(release.guidedWorkflows).toBe(WORKFLOW_CATALOG.length);
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
