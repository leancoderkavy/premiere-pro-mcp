import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const readJson = (path: string) =>
  JSON.parse(readFileSync(join(root, path), "utf8"));

describe("Codex plugin package", () => {
  it("keeps the plugin and MCP package versions aligned", () => {
    const pkg = readJson("package.json");
    const plugin = readJson("plugins/premiere-pro/.codex-plugin/plugin.json");
    const mcp = readJson("plugins/premiere-pro/.mcp.json");

    expect(plugin.name).toBe("premiere-pro");
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.skills).toBe("./skills/");
    expect(plugin.mcpServers).toBe("./.mcp.json");
    expect(mcp.mcpServers["premiere-pro"].args).toContain(
      `premiere-pro-mcp@${pkg.version}`,
    );
  });

  it("publishes the plugin through the repository marketplace", () => {
    const marketplace = readJson(".agents/plugins/marketplace.json");
    const entry = marketplace.plugins.find(
      (plugin: { name: string }) => plugin.name === "premiere-pro",
    );

    expect(marketplace.name).toBe("premiere-pro-mcp");
    expect(entry).toMatchObject({
      source: { source: "local", path: "./plugins/premiere-pro" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Creativity",
    });
  });

  it("ships a complete Premiere editing skill without placeholders", () => {
    const skill = readFileSync(
      join(
        root,
        "plugins",
        "premiere-pro",
        "skills",
        "edit-premiere-project",
        "SKILL.md",
      ),
      "utf8",
    );

    expect(skill).toContain("name: edit-premiere-project");
    expect(skill).toContain("Call `ping`");
    expect(skill).toContain("preview_edit_plan");
    expect(skill).toContain("export_sequence");
    expect(skill).not.toContain("TODO");
  });
});

describe("Claude distributions", () => {
  it("keeps Claude Code metadata aligned with the npm package", () => {
    const pkg = readJson("package.json");
    const marketplace = readJson(".claude-plugin/marketplace.json");
    const plugin = readJson(
      "claude-plugins/premiere-pro/.claude-plugin/plugin.json",
    );
    const mcp = readJson("claude-plugins/premiere-pro/.mcp.json");

    expect(marketplace.name).toBe("premiere-pro-mcp");
    expect(marketplace.plugins[0]).toMatchObject({
      name: "premiere-pro",
      source: "./claude-plugins/premiere-pro",
      version: pkg.version,
    });
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.mcpServers).toBe("./.mcp.json");
    expect(mcp.mcpServers["premiere-pro"].args).toContain(
      `premiere-pro-mcp@${pkg.version}`,
    );
  });

  it("keeps the Claude and Codex editing skills identical", () => {
    const codexSkill = readFileSync(
      join(
        root,
        "plugins",
        "premiere-pro",
        "skills",
        "edit-premiere-project",
        "SKILL.md",
      ),
      "utf8",
    );
    const claudeSkill = readFileSync(
      join(
        root,
        "claude-plugins",
        "premiere-pro",
        "skills",
        "edit-premiere-project",
        "SKILL.md",
      ),
      "utf8",
    );

    expect(claudeSkill).toBe(codexSkill);
  });

  it("defines a self-contained Claude Desktop MCP bundle", () => {
    const pkg = readJson("package.json");
    const manifest = readJson("claude-desktop/manifest.json");

    expect(manifest).toMatchObject({
      manifest_version: "0.4",
      name: "premiere-pro-mcp",
      version: pkg.version,
      server: {
        type: "node",
        entry_point: "server/dist/index.js",
      },
      compatibility: {
        platforms: ["darwin", "win32"],
      },
    });
    expect(manifest.server.mcp_config.args).toContain(
      "${__dirname}/server/dist/index.js",
    );
    expect(manifest.user_config.premiere_uxp_token).toMatchObject({
      type: "string",
      sensitive: true,
      required: true,
    });
    expect(manifest.server.mcp_config.env).toEqual({
      PREMIERE_UXP_TOKEN: "${user_config.premiere_uxp_token}",
    });
  });
});
