import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";

const BIN = join(process.cwd(), "dist", "index.js");

describe("CLI flags", () => {
  it("--help prints usage and exits 0", () => {
    const output = execSync(`node ${BIN} --help`, { encoding: "utf-8" });
    expect(output).toContain("premiere-pro-mcp");
    expect(output).toContain("Usage:");
    expect(output).toContain("--install-cep");
    expect(output).toContain("PREMIERE_TEMP_DIR");
    expect(output).toContain("PREMIERE_TIMEOUT_MS");
  });

  it("-h is an alias for --help", () => {
    const output = execSync(`node ${BIN} -h`, { encoding: "utf-8" });
    expect(output).toContain("Usage:");
  });

  it("--version prints a semver version and exits 0", () => {
    const output = execSync(`node ${BIN} --version`, { encoding: "utf-8" }).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("-v is an alias for --version", () => {
    const output = execSync(`node ${BIN} -v`, { encoding: "utf-8" }).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--version matches package.json version", () => {
    const version = execSync(`node ${BIN} --version`, { encoding: "utf-8" }).trim();
    const pkg = JSON.parse(
      execSync(`cat ${join(process.cwd(), "package.json")}`, { encoding: "utf-8" })
    );
    expect(version).toBe(pkg.version);
  });
});
