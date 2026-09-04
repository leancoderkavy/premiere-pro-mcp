import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "path";

const BIN = join(process.cwd(), "dist", "index.js");

describe("CLI flags", () => {
  it("--help prints usage and exits 0", () => {
    const output = execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf-8" });
    expect(output).toContain("premiere-pro-mcp");
    expect(output).toContain("Usage:");
    expect(output).toContain("--install-cep");
    expect(output).toContain("--uninstall-cep");
    expect(output).toContain("--diagnose-cep");
    expect(output).toContain("--install-after-effects-cep");
    expect(output).toContain("--uninstall-after-effects-cep");
    expect(output).toContain("--diagnose-after-effects-cep");
    expect(output).toContain("PREMIERE_TEMP_DIR");
    expect(output).toContain("PREMIERE_TIMEOUT_MS");
    expect(output).toContain("PREMIERE_MCP_CAPABILITIES");
  });

  it("-h is an alias for --help", () => {
    const output = execFileSync(process.execPath, [BIN, "-h"], { encoding: "utf-8" });
    expect(output).toContain("Usage:");
  });

  it("--version prints a semver version and exits 0", () => {
    const output = execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf-8" }).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("-v is an alias for --version", () => {
    const output = execFileSync(process.execPath, [BIN, "-v"], { encoding: "utf-8" }).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--version matches package.json version", () => {
    const version = execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf-8" }).trim();
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(version).toBe(pkg.version);
  });

  it("--doctor --json emits a privacy-safe machine-readable readiness report", () => {
    const output = execFileSync(process.execPath, [BIN, "--doctor", "--json"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        PREMIERE_UXP_TOKEN: "cli-test-token-that-must-not-appear",
        POSTHOG_API_KEY: "cli-test-key-that-must-not-appear",
      },
    });
    const report = JSON.parse(output);

    expect(report.schemaVersion).toBe("premiere-pro-mcp.doctor.v1");
    expect(report.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ boundary: "installed" }),
      expect.objectContaining({ boundary: "live_verified", state: "not_checked" }),
    ]));
    expect(output).not.toContain("cli-test-token-that-must-not-appear");
    expect(output).not.toContain("cli-test-key-that-must-not-appear");
  });

  it("--support-bundle emits a status snapshot rather than logs or configuration", () => {
    const output = execFileSync(process.execPath, [BIN, "--support-bundle"], { encoding: "utf-8" });
    const bundle = JSON.parse(output);

    expect(bundle.schemaVersion).toBe("premiere-pro-mcp.support-bundle.v1");
    expect(bundle.doctor.schemaVersion).toBe("premiere-pro-mcp.doctor.v1");
    expect(JSON.stringify(bundle)).not.toMatch(/"(?:projectName|mediaName|outputDirectory|arguments|results)"\s*:/);
  });
});
